import {
  InvokeCommand,
  LambdaClient,
  LambdaServiceException,
  TooManyRequestsException,
} from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { z } from "zod";

const minimumRetryAfterSeconds = 1;
const lambdaClient = new LambdaClient({
  // A retry after an ambiguous delivery failure could execute a write twice.
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 2_000, requestTimeout: 35_000 },
});
const headerValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const proxyResponseSchema = z.object({
  statusCode: z.number().int().min(100).max(599),
  body: z.string(),
  headers: z.record(z.string(), headerValueSchema).optional(),
  multiValueHeaders: z.record(z.string(), z.array(headerValueSchema)).optional(),
  isBase64Encoded: z.boolean().optional(),
}).passthrough();

function getRetryAfterSeconds(error: TooManyRequestsException): number {
  const suggestion = error.retryAfterSeconds;
  if (suggestion !== undefined && /^\d+$/.test(suggestion)) {
    const seconds = Number(suggestion);
    if (Number.isSafeInteger(seconds) && seconds >= minimumRetryAfterSeconds) {
      return seconds;
    }
  }
  return minimumRetryAfterSeconds;
}

function createFailureResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  headers: Readonly<Record<string, string>>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      ...headers,
    },
    body: JSON.stringify({ error: message, code, requestId }),
    isBase64Encoded: false,
  };
}

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const requestId = event.requestContext?.requestId ?? context.awsRequestId;
  let phase = "configuration";
  let invocationRequestId: string | undefined;
  let functionError: string | undefined;
  try {
    const workerFunctionName = process.env.MCP_WORKER_FUNCTION_NAME;
    if (workerFunctionName === undefined || workerFunctionName.trim() === "") {
      throw new Error("MCP_WORKER_FUNCTION_NAME is required");
    }

    phase = "invoke";
    const result = await lambdaClient.send(new InvokeCommand({
      FunctionName: workerFunctionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(event)),
    }));
    invocationRequestId = result.$metadata.requestId;
    functionError = result.FunctionError;
    phase = "worker_execution";
    if (result.StatusCode !== 200 || functionError !== undefined) {
      throw new Error("MCP worker invocation did not complete successfully");
    }
    phase = "worker_response";
    if (result.Payload === undefined) {
      throw new Error("MCP worker response payload is missing");
    }

    // Preserve proxy headers (including OAuth challenges), body and base64 bytes.
    return proxyResponseSchema.parse(JSON.parse(Buffer.from(result.Payload).toString("utf8")));
  } catch (error) {
    if (error instanceof TooManyRequestsException) {
      const retryAfterSeconds = getRetryAfterSeconds(error);
      console.warn({
        action: "mcp_worker_capacity_rejected",
        requestId,
        dispatcherRequestId: context.awsRequestId,
        invocationRequestId: error.$metadata.requestId,
        reason: error.Reason,
        retryAfterSeconds,
      });
      return createFailureResponse(
        429,
        "MCP_CONCURRENCY_LIMIT_REACHED",
        "MCP request capacity is temporarily full. Wait for Retry-After before retrying this request.",
        requestId,
        { "Retry-After": String(retryAfterSeconds) },
      );
    }

    // Never log request/response bodies: they can contain bearer tokens and card data.
    console.error({
      action: "mcp_dispatch_failed",
      requestId,
      dispatcherRequestId: context.awsRequestId,
      phase,
      errorName: error instanceof Error ? error.name : "NonErrorThrown",
      invocationRequestId: error instanceof LambdaServiceException
        ? error.$metadata.requestId : invocationRequestId,
      invocationStatusCode: error instanceof LambdaServiceException
        ? error.$metadata.httpStatusCode : undefined,
      functionError,
    });
    return createFailureResponse(
      502,
      "MCP_DISPATCH_FAILED",
      "MCP request could not be completed. Provide the request ID when contacting support.",
      requestId,
      {},
    );
  }
}
