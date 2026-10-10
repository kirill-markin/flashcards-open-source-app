import type { Context } from "aws-lambda";
import type { ChatSandboxBashResponse } from "../chatSandbox/contract";
import { handleChatSandboxRequest } from "../chatSandbox/handler";

/** Invoked synchronously by the chat worker only; see `../chatSandbox/handler.ts` for the boundary. */
export async function handler(event: unknown, context: Context): Promise<ChatSandboxBashResponse> {
  return handleChatSandboxRequest(event, context.awsRequestId);
}
