/**
 * Backend-owned chat worker dispatch helpers.
 * The route layer persists the run first, then this module triggers the worker so the run survives client disconnects.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { markQueuedChatRunDispatchFailed } from "./runs";

export type ChatWorkerInvocation = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
}>;

let lambdaClient: LambdaClient | null = null;

/**
 * Returns the process-local Lambda client used to trigger chat workers.
 */
function getLambdaClient(): LambdaClient {
  if (lambdaClient === null) {
    lambdaClient = new LambdaClient({});
  }

  return lambdaClient;
}

/**
 * Reads the Lambda function name that owns backend-owned chat execution.
 */
function getChatWorkerFunctionName(): string {
  const functionName = process.env.CHAT_WORKER_FUNCTION_NAME;
  if (functionName === undefined || functionName === "") {
    throw new Error("CHAT_WORKER_FUNCTION_NAME environment variable is not set");
  }

  return functionName;
}

/**
 * Dispatches a persisted chat run to the asynchronous worker without waiting for completion.
 */
export async function invokeChatWorker(
  payload: ChatWorkerInvocation,
): Promise<void> {
  const command = new InvokeCommand({
    FunctionName: getChatWorkerFunctionName(),
    InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  });

  await getLambdaClient().send(command);
}

/**
 * Dispatches a persisted chat run and marks it as failed if worker invocation itself fails.
 */
export async function invokeChatWorkerOrPersistFailure(
  payload: ChatWorkerInvocation,
): Promise<void> {
  try {
    await invokeChatWorker(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markQueuedChatRunDispatchFailed(
      payload.userId,
      payload.workspaceId,
      payload.runId,
      `Chat worker dispatch failed: ${message}`,
    );
    throw error;
  }
}
