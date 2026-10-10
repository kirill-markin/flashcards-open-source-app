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
/** Node's codes for a connection that never opened, so the request never reached Lambda. */
const unsentInvokeErrorCodes: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
const answerLostErrorType = "Invoke.AnswerLost";

/**
 * A call the sandbox did not answer. `errorType` is Lambda's name for the failure, such as
 * `Sandbox.Timedout`, or `Invoke.AnswerLost` for an answer lost in transport, and `sandboxErrorMessage`
 * the sandbox's own message or the invoke's, which reaches the model.
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
  /** Called once for each prepared attempt that was not throttled and for which no invocation is returned. */
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

/** Node's code of a failed request, such as `ECONNRESET`. */
function readErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

/** Throttling, or a connection that never opened: the sandbox did not run the call. */
function isRefusedInvokeError(error: unknown): boolean {
  if (error instanceof TooManyRequestsException) {
    return true;
  }

  const code = readErrorCode(error);
  return code !== null && unsentInvokeErrorCodes.has(code);
}

/**
 * A transport error that is no refusal has no HTTP status because no answer arrived, though the sandbox
 * may have run the call.
 */
function isAnswerLostInvokeError(error: unknown): boolean {
  const metadata = typeof error === "object" && error !== null && "$metadata" in error ? error.$metadata : null;
  const statusCode = typeof metadata === "object" && metadata !== null && "httpStatusCode" in metadata
    ? metadata.httpStatusCode
    : undefined;
  return statusCode === undefined && !isRefusedInvokeError(error);
}

/**
 * A run whose answer was lost left only uploads no row names, so it runs again, unless it is a command
 * whose code may have sent SQL writes, which must not land twice.
 */
function mayRunAgainAfterLostAnswer(request: ChatSandboxRequest): boolean {
  return request.operation !== "bash" || request.sqlBridge === undefined;
}

/** The name and code only: a network error's message can carry the host, and this one reaches the model. */
function createAnswerLostError(error: unknown): ChatSandboxFunctionError {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = readErrorCode(error);
  return new ChatSandboxFunctionError(
    answerLostErrorType,
    `its answer was lost in transport (errorName=${name}${code === null ? "" : ` errorCode=${code}`}), `
      + "so the command may have run in full",
    null,
  );
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
      if (signal?.aborted !== true && isAnswerLostInvokeError(error) && !mayRunAgainAfterLostAnswer(request)) {
        return { status: "failed", error: createAnswerLostError(error), sandboxRequestId: null };
      }

      if (!(error instanceof TooManyRequestsException)) {
        attempts.abandon(error);
      }

      signal?.throwIfAborted();
      const retryDelayMs = invokeRetryDelaysMs[attempt - 1];
      if (!(isRefusedInvokeError(error) || isAnswerLostInvokeError(error)) || retryDelayMs === undefined) {
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
