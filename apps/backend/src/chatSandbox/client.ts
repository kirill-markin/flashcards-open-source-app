import {
  InvokeCommand,
  LambdaClient,
  TooManyRequestsException,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import type { BackendObservationScope } from "../observability/sentry";
import type { ChatSandboxRequest } from "./contract";

/**
 * What Lambda returns for a call the sandbox did not answer: a thrown error, a timeout, running out of
 * memory. A payload without `errorType` is named by the invoke's own `FunctionError`.
 */
const sandboxFunctionErrorSchema = z.object({
  errorType: z.string().optional(),
  errorMessage: z.string(),
});
const invokeRetryDelaysMs: ReadonlyArray<number> = [1_000, 2_000, 4_000];

/**
 * A call the sandbox did not answer. `errorType` is Lambda's name for the failure, such as
 * `Sandbox.Timedout`, and `sandboxErrorMessage` the sandbox's own message, which reaches the model.
 */
export class ChatSandboxFunctionError extends Error {
  public readonly errorType: string;
  public readonly sandboxErrorMessage: string;

  public constructor(errorType: string, sandboxErrorMessage: string, sandboxRequestId: string | null) {
    super(
      `Chat sandbox did not answer the call. errorType=${errorType} `
        + `sandboxRequestId=${String(sandboxRequestId)} errorMessage=${sandboxErrorMessage}`,
    );
    this.name = "ChatSandboxFunctionError";
    this.errorType = errorType;
    this.sandboxErrorMessage = sandboxErrorMessage;
  }
}

export type ChatSandboxInvocation<Response> =
  | Readonly<{
    status: "completed";
    response: Response;
    sandboxRequestId: string | null;
  }>
  | Readonly<{
    status: "failed";
    error: ChatSandboxFunctionError;
    sandboxRequestId: string | null;
  }>;

/**
 * An attempt whose answer is lost may still be running and uploading, so every attempt gets a request
 * of its own, with write slots and URLs no other attempt has.
 */
export type ChatSandboxAttempts<Request extends ChatSandboxRequest> = Readonly<{
  prepare: () => Promise<Request>;
  /** Called once for each prepared attempt that was not throttled and whose answer is never returned. */
  abandon: (error: unknown) => void;
}>;

let lambdaClient: LambdaClient | null = null;

/** Retries are decided below; the request timeout outlives the sandbox's own 2-minute timeout. */
function getLambdaClient(): LambdaClient {
  lambdaClient ??= new LambdaClient({
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2_000, requestTimeout: 150_000 },
  });
  return lambdaClient;
}

function getChatSandboxFunctionName(): string {
  const functionName = process.env.CHAT_SANDBOX_FUNCTION_NAME;
  if (functionName === undefined || functionName === "") {
    throw new Error("CHAT_SANDBOX_FUNCTION_NAME environment variable is not set");
  }

  return functionName;
}

/**
 * Throttling is refused before the sandbox runs. A transport error has no HTTP status because no answer
 * arrived; a sandbox that did run then left only uploads no row names, and the operation runs again.
 */
function isRetryableInvokeError(error: unknown): boolean {
  if (error instanceof TooManyRequestsException) {
    return true;
  }

  const metadata = typeof error === "object" && error !== null && "$metadata" in error ? error.$metadata : null;
  const statusCode = typeof metadata === "object" && metadata !== null && "httpStatusCode" in metadata
    ? metadata.httpStatusCode
    : undefined;
  return statusCode === undefined;
}

function readInvocationOutput<Response>(
  output: InvokeCommandOutput,
  responseSchema: z.ZodType<Response>,
): ChatSandboxInvocation<Response> {
  const sandboxRequestId = output.$metadata.requestId ?? null;
  if (output.StatusCode !== 200 || output.Payload === undefined) {
    throw new Error(
      `Chat sandbox invoke returned no payload. statusCode=${String(output.StatusCode)} sandboxRequestId=${String(sandboxRequestId)}`,
    );
  }

  const payload: unknown = JSON.parse(Buffer.from(output.Payload).toString("utf8"));
  if (output.FunctionError !== undefined) {
    const error = sandboxFunctionErrorSchema.parse(payload);
    return {
      status: "failed",
      error: new ChatSandboxFunctionError(
        error.errorType ?? output.FunctionError,
        error.errorMessage,
        sandboxRequestId,
      ),
      sandboxRequestId,
    };
  }

  return { status: "completed", response: responseSchema.parse(payload), sandboxRequestId };
}

export async function invokeChatSandbox<Request extends ChatSandboxRequest, Response>(
  attempts: ChatSandboxAttempts<Request>,
  responseSchema: z.ZodType<Response>,
  signal: AbortSignal | null,
  observationScope: BackendObservationScope,
): Promise<ChatSandboxInvocation<Response>> {
  const functionName = getChatSandboxFunctionName();
  for (let attempt = 1; ; attempt += 1) {
    const request = await attempts.prepare();
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(request)),
    });
    let output: InvokeCommandOutput;
    try {
      output = await getLambdaClient().send(command, signal === null ? {} : { abortSignal: signal });
    } catch (error) {
      if (!(error instanceof TooManyRequestsException)) {
        attempts.abandon(error);
      }

      signal?.throwIfAborted();
      const retryDelayMs = invokeRetryDelaysMs[attempt - 1];
      if (!isRetryableInvokeError(error) || retryDelayMs === undefined) {
        throw error;
      }

      writeCloudWatchRecord({
        action: "chat_sandbox_invoke_retried",
        message: "Chat sandbox invoke will retry after throttling or a transport error.",
        scope: observationScope,
        details: {
          attempt,
          retryDelayMs,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        },
      }, "warning");
      await sleep(retryDelayMs, undefined, signal === null ? {} : { signal });
      continue;
    }

    try {
      return readInvocationOutput(output, responseSchema);
    } catch (error) {
      attempts.abandon(error);
      throw error;
    }
  }
}
