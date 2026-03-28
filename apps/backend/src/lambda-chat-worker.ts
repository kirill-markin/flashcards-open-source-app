import type { Handler } from "aws-lambda";
import { handleChatWorkerEvent, type ChatWorkerEvent } from "./chat/worker";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();

export const handler: Handler<ChatWorkerEvent, void> = async (event) => {
  await handleChatWorkerEvent(event);
};
