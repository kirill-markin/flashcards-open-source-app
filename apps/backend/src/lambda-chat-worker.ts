import type { Handler } from "aws-lambda";
import { handleChatWorkerEvent, type ChatWorkerEvent } from "./chat/worker";

export const handler: Handler<ChatWorkerEvent, void> = async (event) => {
  await handleChatWorkerEvent(event);
};
