import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../../errors";
import type { ChatSessionSnapshot } from "../store";
import type { RequestContext } from "../../server/requestContext";

export const SESSION_ONE = "11111111-1111-4111-8111-111111111111";
export const SESSION_TWO = "22222222-2222-4222-8222-222222222222";
export const EXPLICIT_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
export const RUN_ONE = "44444444-4444-4444-8444-444444444444";
export const LEGACY_WORKSPACE_ID = "workspace-legacy";

export function createRequestContext(): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "user-1",
    selectedWorkspaceId: "workspace-1",
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-03-30T00:00:00.000Z",
    transport: "bearer",
    connectionId: null,
  };
}

export function createRequestContextWithSelectedWorkspace(selectedWorkspaceId: string | null): RequestContext {
  return {
    ...createRequestContext(),
    selectedWorkspaceId,
  };
}

export function createSnapshot(messages: ChatSessionSnapshot["messages"]): ChatSessionSnapshot {
  return {
    sessionId: SESSION_ONE,
    runState: "idle",
    activeRunId: null,
    updatedAt: 1,
    activeRunHeartbeatAt: null,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages,
  };
}

export function createRunningSnapshot(messages: ChatSessionSnapshot["messages"]): ChatSessionSnapshot {
  return {
    sessionId: SESSION_ONE,
    runState: "running",
    activeRunId: "run-1",
    updatedAt: 1,
    activeRunHeartbeatAt: 1,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages,
  };
}

export function createExpectedChatConfig(): Record<string, unknown> {
  return {
    provider: {
      id: "openai",
      label: "OpenAI",
    },
    model: {
      id: "gpt-5.4",
      label: "GPT-5.4",
      badgeLabel: "GPT-5.4 · Medium",
    },
    reasoning: {
      effort: "medium",
      label: "Medium",
    },
    features: {
      modelPickerEnabled: false,
      dictationEnabled: true,
      attachmentsEnabled: true,
    },
    liveUrl: null,
  };
}

export function toHttpErrorLike(error: unknown): { statusCode: number; message: string; code: string | null } | null {
  if (error instanceof HttpError) {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const message = "message" in error ? error.message : undefined;
  const code = "code" in error ? error.code : undefined;
  if (typeof statusCode !== "number" || typeof message !== "string" || (typeof code !== "string" && code !== null)) {
    return null;
  }

  return { statusCode, message, code };
}

export function createRoutesWithHttpErrorJson(): Hono {
  const app = new Hono();
  app.onError((error, context) => {
    const httpError = toHttpErrorLike(error);
    if (httpError !== null) {
      context.status(httpError.statusCode as ContentfulStatusCode);
      return context.json({
        error: httpError.message,
        requestId: null,
        code: httpError.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: null,
      code: "INTERNAL_ERROR",
    });
  });
  return app;
}
