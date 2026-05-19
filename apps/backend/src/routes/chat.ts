/**
 * Route factory for the backend-owned chat surface.
 * These routes accept user turn input, resolve or create server-owned sessions, and schedule persisted runs for asynchronous execution.
 */
import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  createChatRouteDependencies,
  createGetChatHandler,
  createPostChatHandler,
  createPostChatNewHandler,
  createPostChatStopHandler,
  type ChatRoutesOptions,
} from "../chat/http";

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
 * Mounts the backend-owned `/chat` routes for history, start, new-session, and stop operations.
 */
export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const dependencies = createChatRouteDependencies(options);

  app.get("/chat", createGetChatHandler(dependencies));
  app.post("/chat", createPostChatHandler(dependencies));
  app.post("/chat/new", createPostChatNewHandler(dependencies));
  app.post("/chat/stop", createPostChatStopHandler(dependencies));

  return app;
}
