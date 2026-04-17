import type { Handler } from "aws-lambda";
import { handleChatWorkerEvent, type ChatWorkerEvent } from "./chat/worker";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();

export const handler: Handler<ChatWorkerEvent, void> = async (event, context) => {
  await handleChatWorkerEvent(event, {
    lambdaRequestId: context.awsRequestId ?? null,
    getRemainingTimeInMillis: (): number => context.getRemainingTimeInMillis(),
  });
};
