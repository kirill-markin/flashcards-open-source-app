import "fake-indexeddb/auto";
import { afterEach, beforeEach, vi } from "vitest";
import type { NewChatSessionResponse } from "../../types";
import {
  createJsonResponse,
  createNewChatSessionResponse,
  createStorageMock,
  setNavigatorLanguages,
} from "../ApiTestSupport";
import { createNewChatSession } from "../endpoints/chat";
import { resetApiClientStateForTests } from "./transport";

export async function createTransportBackedChatSession(
  sessionId: string,
): Promise<NewChatSessionResponse> {
  return createNewChatSession(sessionId, "workspace-1", "en");
}

export function createWorkspacesResponse(): Response {
  return createJsonResponse({
    workspaces: [{
      workspaceId: "workspace-1",
      name: "Default",
      createdAt: "2026-04-10T00:00:00.000Z",
      isSelected: true,
    }],
    nextCursor: null,
  });
}

function createFailingResponse(
  error: Error,
  requestId: string,
  statusCode: number,
  contentType: string,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: statusCode,
    headers: {
      "Content-Type": contentType,
      "X-Request-Id": requestId,
    },
  });
}

export function createFailingJsonResponse(
  error: Error,
  requestId: string,
  statusCode: number,
): Response {
  return createFailingResponse(error, requestId, statusCode, "application/json");
}

export function createFailingBlobResponse(error: Error, requestId: string): Response {
  return createFailingResponse(error, requestId, 200, "application/octet-stream");
}

export type DeferredResponsePromise = Readonly<{
  promise: Promise<Response>;
  reject: (error: Error) => void;
  resolve: (value: Response) => void;
}>;

export function createDeferredResponsePromise(): DeferredResponsePromise {
  let rejectPromise: ((error: Error) => void) | null = null;
  let resolvePromise: ((value: Response) => void) | null = null;
  const promise = new Promise<Response>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  if (rejectPromise === null || resolvePromise === null) {
    throw new Error("Deferred response promise callbacks were not initialized");
  }

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

export async function waitForFetchCallCount(
  fetchMock: ReturnType<typeof vi.fn<(...args: Array<unknown>) => Promise<Response>>>,
  expectedCallCount: number,
): Promise<void> {
  for (let attemptCount = 0; attemptCount < 20; attemptCount += 1) {
    if (fetchMock.mock.calls.length >= expectedCallCount) {
      return;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  throw new Error(`Expected fetch to be called ${expectedCallCount} times`);
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  resetApiClientStateForTests();
});

afterEach(() => {
  window.localStorage.clear();
  setNavigatorLanguages([], "");
  resetApiClientStateForTests();
  vi.restoreAllMocks();
});
