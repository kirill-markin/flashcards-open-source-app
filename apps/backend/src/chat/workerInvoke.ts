import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { markQueuedChatRunDispatchFailed } from "./runs";

export type ChatWorkerInvocation = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
}>;

let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (lambdaClient === null) {
    lambdaClient = new LambdaClient({});
  }

  return lambdaClient;
}

function getChatWorkerFunctionName(): string {
  const functionName = process.env.CHAT_WORKER_FUNCTION_NAME;
  if (functionName === undefined || functionName === "") {
    throw new Error("CHAT_WORKER_FUNCTION_NAME environment variable is not set");
  }

  return functionName;
}

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
