/**
 * Route factory for the backend-owned chat surface.
 * These routes accept user turn input, resolve or create server-owned sessions, and schedule persisted runs for asynchronous execution.
 */
import { Hono } from "hono";
import type { AppEnv } from "../server/app";
import {
  createChatRouteDependencies,
  createGetChatHandler,
  createGetChatSessionsHandler,
  createPostChatFileUploadHandler,
  createPostChatHandler,
  createPostChatNewHandler,
  createPostChatSessionArchiveHandler,
  createPostChatSessionRenameHandler,
  createPostChatStopHandler,
  type ChatRoutesOptions,
} from "../chat/http";
import { chatSandboxSqlRoutePath } from "../chatSandbox/sqlBridge/capability";
import { handleChatSandboxSqlRequest } from "../chatSandbox/sqlBridge/route";

export type {
  ChatContentPart,
  ChatRequestBody,
} from "../chat/http";

export {
  parseChatRequestBody,
  parseNewChatRequestBody,
  parseStopChatRequestBody,
} from "../chat/http";

/**
 * Mounts the backend-owned `/chat` routes for history, start, new-session, stop, and chat-list operations,
 * and the chat sandbox's SQL bridge.
 */
export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const dependencies = createChatRouteDependencies(options);

  app.get("/chat", createGetChatHandler(dependencies));
  app.post("/chat", createPostChatHandler(dependencies));
  app.post("/chat/files/uploads", createPostChatFileUploadHandler(dependencies));
  app.post("/chat/new", createPostChatNewHandler(dependencies));
  app.post("/chat/stop", createPostChatStopHandler(dependencies));
  app.get("/chat/sessions", createGetChatSessionsHandler(dependencies));
  app.post("/chat/sessions/:sessionId/rename", createPostChatSessionRenameHandler(dependencies));
  app.post("/chat/sessions/:sessionId/archive", createPostChatSessionArchiveHandler(dependencies));
  app.post(chatSandboxSqlRoutePath, handleChatSandboxSqlRequest);

  return app;
}
