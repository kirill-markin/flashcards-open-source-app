/**
 * Route factory for the backend-owned chat surface.
 * These routes accept user turn input, resolve or create server-owned sessions, and schedule persisted runs for asynchronous execution.
 */
import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  createChatRouteDependencies,
  type ChatRoutesOptions,
} from "../chat/routeDependencies";
import {
  createGetChatHandler,
  createPostChatHandler,
  createPostChatNewHandler,
  createPostChatStopHandler,
} from "../chat/routeHandlers";

export type {
  ChatContentPart,
  ChatRequestBody,
} from "../chat/routeContract";

export {
  parseChatRequestBody,
  parseNewChatRequestBody,
  parseStopChatRequestBody,
} from "../chat/routeContract";

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
