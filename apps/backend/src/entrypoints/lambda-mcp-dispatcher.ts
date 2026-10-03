import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  InvokeCommand,
  type InvokeCommandOutput,
  LambdaClient,
  LambdaServiceException,
  TooManyRequestsException,
} from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { createHash } from "node:crypto";
import { z } from "zod";

const minimumRetryAfterSeconds = 1;
// Per-token fairness, not security: the worker still verifies every token.
const clientLeaseSlotCount = 4;
// Outlives the 40 s dispatcher timeout, so a crashed invocation frees its slot.
const clientLeaseTtlSeconds = 60;
const clientCapacityRetryAfterSeconds = 1;
const bearerTokenPattern = /^Bearer\s+(\S+)$/i;
const dynamoDbClient = new DynamoDBClient({
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
});
// Equal-jitter backoff bases for re-invoking a worker that refused admission:
// each wait is half its base plus a random share of the other half.
const admissionRetryBaseDelaysMs: ReadonlyArray<number> = [200, 400, 800, 1_600];
// No admission wait starts that would end later than this after handler entry.
const admissionRetryBudgetMs = 3_000;
const httpMethodSchema = z.enum([
  "GET", "HEAD", "POST", "PUT", "DELETE", "CONNECT", "OPTIONS", "TRACE", "PATCH",
]);
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

function getWorkerRequestId(response: APIGatewayProxyResult): string | null {
  const headers = [
    ...Object.entries(response.headers ?? {}),
    ...Object.entries(response.multiValueHeaders ?? {}).map(([name, values]) => [name, values[0]] as const),
  ];
  const requestId = headers.find(([name]) => name.toLowerCase() === "x-request-id")?.[1];
  return z.string().uuid().safeParse(requestId).data ?? null;
}

type ClientLease = Readonly<{ tableName: string; pk: string; leaseId: string }>;

function getBearerToken(event: APIGatewayProxyEvent): string | null {
  const authorizationValues = [
    ...Object.entries(event.headers ?? {}).map(([name, value]) => [name, value] as const),
    ...Object.entries(event.multiValueHeaders ?? {})
      .flatMap(([name, values]) => (values ?? []).map((value) => [name, value] as const)),
  ].filter(([name]) => name.toLowerCase() === "authorization").map(([, value]) => value);
  for (const value of authorizationValues) {
    const token = value === undefined ? undefined : bearerTokenPattern.exec(value.trim())?.[1];
    if (token !== undefined) {
      return token;
    }
  }
  return null;
}

function getShuffledLeaseSlots(): ReadonlyArray<number> {
  const slots = Array.from({ length: clientLeaseSlotCount }, (_, slot) => slot);
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [slots[index], slots[swapIndex]] = [slots[swapIndex], slots[index]];
  }
  return slots;
}

/** Returns null when every slot for this token is held by an unexpired lease. */
async function acquireClientLease(
  tableName: string,
  token: string,
  leaseId: string,
): Promise<ClientLease | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  for (const slot of getShuffledLeaseSlots()) {
    const pk = `${tokenHash}#${slot}`;
    const nowSeconds = Math.floor(Date.now() / 1_000);
    try {
      await dynamoDbClient.send(new PutItemCommand({
        TableName: tableName,
        Item: {
          pk: { S: pk },
          leaseId: { S: leaseId },
          expiresAt: { N: String(nowSeconds + clientLeaseTtlSeconds) },
        },
        // Matching our own leaseId keeps an SDK retry of a delivered put from
        // failing against the lease it just wrote.
        ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now OR leaseId = :leaseId",
        ExpressionAttributeValues: { ":now": { N: String(nowSeconds) }, ":leaseId": { S: leaseId } },
      }));
      return { tableName, pk, leaseId };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
    }
  }
  return null;
}

async function releaseClientLease(lease: ClientLease): Promise<void> {
  await dynamoDbClient.send(new DeleteItemCommand({
    TableName: lease.tableName,
    Key: { pk: { S: lease.pk } },
    ConditionExpression: "leaseId = :leaseId",
    ExpressionAttributeValues: { ":leaseId": { S: lease.leaseId } },
  }));
}

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

function getAdmissionRetryDelayMs(error: unknown, attempts: number, elapsedMs: number): number | null {
  const baseDelayMs = admissionRetryBaseDelaysMs[attempts - 1];
  if (!(error instanceof TooManyRequestsException) || baseDelayMs === undefined) {
    return null;
  }
  const delayMs = baseDelayMs / 2 + Math.random() * baseDelayMs / 2;
  return elapsedMs + delayMs > admissionRetryBudgetMs ? null : delayMs;
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
  const startedAt = performance.now();
  const requestId = event.requestContext?.requestId ?? context.awsRequestId;
  const method = httpMethodSchema.safeParse(event.httpMethod).data ?? "OTHER";
  let phase = "configuration";
  let invocationRequestId: string | undefined;
  let functionError: string | undefined;
  let attempts = 0;
  let clientLease: ClientLease | null = null;
  try {
    const workerFunctionName = process.env.MCP_WORKER_FUNCTION_NAME;
    if (workerFunctionName === undefined || workerFunctionName.trim() === "") {
      throw new Error("MCP_WORKER_FUNCTION_NAME is required");
    }
    const leaseTableName = process.env.MCP_TOKEN_LEASE_TABLE_NAME;
    if (leaseTableName === undefined || leaseTableName.trim() === "") {
      throw new Error("MCP_TOKEN_LEASE_TABLE_NAME is required");
    }

    // Requests without a bearer token skip the limiter: the worker answers them
    // with a cheap 401.
    const token = getBearerToken(event);
    if (token !== null) {
      phase = "client_lease";
      clientLease = await acquireClientLease(leaseTableName, token, context.awsRequestId);
      if (clientLease === null) {
        console.warn({
          action: "mcp_client_capacity_rejected",
          requestId,
          dispatcherRequestId: context.awsRequestId,
          method,
          statusCode: 429,
          durationMs: Math.round(performance.now() - startedAt),
          attempts,
          retryAfterSeconds: clientCapacityRetryAfterSeconds,
        });
        return createFailureResponse(
          429,
          "MCP_CLIENT_CONCURRENCY_LIMIT_REACHED",
          `This access token already has ${clientLeaseSlotCount} MCP requests in progress. Wait for Retry-After before retrying this request.`,
          requestId,
          { "Retry-After": String(clientCapacityRetryAfterSeconds) },
        );
      }
    }

    phase = "invoke";
    const payload = Buffer.from(JSON.stringify(event));
    let result: InvokeCommandOutput | undefined;
    while (result === undefined) {
      attempts += 1;
      try {
        result = await lambdaClient.send(new InvokeCommand({
          FunctionName: workerFunctionName,
          InvocationType: "RequestResponse",
          Payload: payload,
        }));
      } catch (error) {
        // Safe to re-invoke: Lambda rejects a throttled synchronous invoke before
        // the worker runs, so a retry cannot execute the request twice.
        const delayMs = getAdmissionRetryDelayMs(error, attempts, performance.now() - startedAt);
        if (delayMs === null) {
          throw error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
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

    const response = proxyResponseSchema.parse(JSON.parse(Buffer.from(result.Payload).toString("utf8")));
    const durationMs = Math.round(performance.now() - startedAt);
    console.log({
      action: "mcp_worker_completed",
      requestId,
      dispatcherRequestId: context.awsRequestId,
      invocationRequestId,
      workerRequestId: getWorkerRequestId(response),
      method,
      statusCode: response.statusCode,
      durationMs,
      attempts,
    });
    return response;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof TooManyRequestsException) {
      const retryAfterSeconds = getRetryAfterSeconds(error);
      console.warn({
        action: "mcp_worker_capacity_rejected",
        requestId,
        dispatcherRequestId: context.awsRequestId,
        invocationRequestId: error.$metadata.requestId,
        method,
        statusCode: 429,
        durationMs,
        attempts,
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
      method,
      statusCode: 502,
      durationMs,
      attempts,
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
  } finally {
    if (clientLease !== null) {
      try {
        await releaseClientLease(clientLease);
      } catch (error) {
        // The response stands: an unreleased lease expires on its own.
        console.warn({
          action: "mcp_client_lease_release_failed",
          requestId,
          dispatcherRequestId: context.awsRequestId,
          errorName: error instanceof Error ? error.name : "NonErrorThrown",
        });
      }
    }
  }
}
