// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBrowserReauthRequired } from "../../accountDeletion";
import { ApiContractError } from "../../apiContracts/core";
import { persistLocalePreference } from "../../i18n/runtime";
import type { NewChatSessionResponse } from "../../types";
import {
  createChatSnapshotResponse,
  createJsonResponse,
  createNewChatSessionResponse,
  createSessionResponse,
  createStartChatRunResponse,
  createStorageMock,
  expectLocalBrowserStatePreserved,
  expectLocalBrowserStatePreservedForReauth,
  spyOnDeleteDatabase,
  seedLocalBrowserState,
  setNavigatorLanguages,
} from "../ApiTestSupport";
import {
  createNewChatSession,
  getChatSnapshot,
  startChatRun,
  stopChatRun,
} from "../endpoints/chat";
import { ApiError, ApiNetworkError, AuthRedirectError } from "./errors";
import { pullSyncChanges } from "../endpoints/sync";
import {
  allowAuthRecovery,
  getSession,
  primeSessionCsrfToken,
  requestJson,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
} from "./transport";
import { listWorkspaces } from "../endpoints/workspaces";

async function createTransportBackedChatSession(sessionId: string): Promise<NewChatSessionResponse> {
  return createNewChatSession(sessionId, "workspace-1", "en");
}

function createWorkspacesResponse(): Response {
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

type DeferredResponsePromise = Readonly<{
  promise: Promise<Response>;
  reject: (error: Error) => void;
  resolve: (value: Response) => void;
}>;

function createDeferredResponsePromise(): DeferredResponsePromise {
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

async function waitForFetchCallCount(
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

describe("session transport auth recovery", () => {
  it("uses the stored app locale when auth recovery redirects to login", async () => {
    seedLocalBrowserState();
    persistLocalePreference("ar");
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toBeInstanceOf(AuthRedirectError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(new URL(redirectedUrl).searchParams.get("locale")).toBe("ar");
    expectLocalBrowserStatePreservedForReauth();
    expect(isBrowserReauthRequired()).toBe(true);
  });

  it("treats a second 401 after refresh recovery as an auth redirect", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toBeInstanceOf(AuthRedirectError);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(new URL(redirectedUrl).pathname).toBe("/login");
    expectLocalBrowserStatePreservedForReauth();
    expect(isBrowserReauthRequired()).toBe(true);
  });

  it("retries transient refresh-service failures before surfacing the final error", async () => {
    seedLocalBrowserState();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    function createRefreshFailureResponse(): Response {
      return new Response(JSON.stringify({
        error: "Authentication failed. Try again.",
        code: "INTERNAL_ERROR",
        requestId: "body-refresh-request-id",
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "header-refresh-request-id",
        },
      });
    }
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(createRefreshFailureResponse())
      .mockResolvedValueOnce(createRefreshFailureResponse())
      .mockResolvedValueOnce(createRefreshFailureResponse());
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toMatchObject({
      statusCode: 500,
      message: "Authentication failed. Try again.",
      code: "INTERNAL_ERROR",
      requestId: "header-refresh-request-id",
      endpoint: "POST /api/refresh-session",
      responseBodyKind: "json",
    } satisfies Partial<ApiError>);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(redirectedUrl).toBe("");
    expectLocalBrowserStatePreserved();
  });

  it("keeps request metadata on API errors with header requestId priority", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Session metadata failed.",
        code: "SESSION_METADATA_FAILED",
        requestId: "body-request-id",
      }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "header-request-id",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).rejects.toMatchObject({
      statusCode: 503,
      message: "Session metadata failed.",
      code: "SESSION_METADATA_FAILED",
      requestId: "header-request-id",
      endpoint: "GET /me",
      responseBodyKind: "json",
    } satisfies Partial<ApiError>);
  });

  it("uses API Gateway request id headers when Lambda request id is absent", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, {
        status: 503,
        headers: {
          "X-Amzn-RequestId": "gateway-request-id",
          "X-Amz-Apigw-Id": "gateway-execution-id",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).rejects.toMatchObject({
      statusCode: 503,
      message: "Request failed with status 503",
      code: null,
      requestId: "gateway-request-id",
      endpoint: "GET /me",
      responseBodyKind: "empty",
    } satisfies Partial<ApiError>);
  });

  it("keeps request metadata on API contract errors after successful responses", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        selectedWorkspaceId: "workspace-1",
        authTransport: "session",
        csrfToken: "csrf-token-1",
        code: "SESSION_CONTRACT_FAILED",
        requestId: "body-request-id",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "header-request-id",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).rejects.toMatchObject({
      endpoint: "GET /me",
      fieldPath: "profile",
      expected: "object",
      requestId: "header-request-id",
      statusCode: 200,
      code: "SESSION_CONTRACT_FAILED",
      responseBodyKind: "json",
    } satisfies Partial<ApiContractError>);
  });

  it("deduplicates cleanup for parallel requests that end in one auth redirect", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const redirectedUrls: Array<string> = [];
    setNavigationHandlerForTests((url: string) => {
      redirectedUrls.push(url);
    });

    const results = await Promise.allSettled([getSession(), getSession()]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AuthRedirectError);
      }
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(redirectedUrls).toHaveLength(1);
    expectLocalBrowserStatePreservedForReauth();
    expect(isBrowserReauthRequired()).toBe(true);
  });

  it("redirects to login without attempting IndexedDB cleanup", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = spyOnDeleteDatabase();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toBeInstanceOf(AuthRedirectError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(new URL(redirectedUrl).pathname).toBe("/login");
    expectLocalBrowserStatePreservedForReauth();
    expect(isBrowserReauthRequired()).toBe(true);
  });
});

describe("unsafe request session transport", () => {
  it("bootstraps session transport before the first unsafe request", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createTransportBackedChatSession("session-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("reloads the session CSRF token and retries once after a stale CSRF rejection", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-1",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Invalid X-CSRF-Token header",
        code: "SESSION_CSRF_TOKEN_INVALID",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createTransportBackedChatSession("session-1");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const staleRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const retriedRequestInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    expect(new Headers(staleRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(new Headers(retriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
  });

  it("uses normal auth recovery when the retry after stale CSRF returns unauthorized", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-1",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Invalid X-CSRF-Token header",
        code: "SESSION_CSRF_TOKEN_INVALID",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-3",
      }))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createTransportBackedChatSession("session-1");

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[6]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const firstRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const csrfRetriedRequestInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    const authRetriedRequestInit = fetchMock.mock.calls[6]?.[1] as RequestInit | undefined;
    expect(new Headers(firstRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(new Headers(csrfRetriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
    expect(new Headers(authRetriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-3");
  });

  it("deduplicates session transport bootstrap for parallel unsafe requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-2"));
    vi.stubGlobal("fetch", fetchMock);

    const [firstResponse, secondResponse] = await Promise.all([
      createTransportBackedChatSession("session-1"),
      createTransportBackedChatSession("session-2"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "http://localhost:8080/v1/me")).toHaveLength(1);
    expect(firstResponse.sessionId).toBe("session-1");
    expect(secondResponse.sessionId).toBe("session-2");
  });

  it("recovers an expired session before the first unsafe request", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createTransportBackedChatSession("session-1");

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8080/v1/chat/new");
  });

  it("surfaces local CSRF preconditions without mapping them to API unavailable", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTransportBackedChatSession("session-1")).rejects.toThrow(
      "CSRF token is not loaded for this browser session",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("API transport network retry", () => {
  it("retries a transient network failure for session bootstrap reads", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createSessionResponse(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toMatchObject({
      userId: "user-1",
      selectedWorkspaceId: "workspace-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
      maximumAttemptCount: 4,
      nextAttemptCount: 2,
      originalErrorName: "TypeError",
      originalErrorMessage: "Failed to fetch",
    }));
  });

  it("raises a structured API network error after session bootstrap retry attempts are exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const sessionPromise = getSession();

    await expect(sessionPromise).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(sessionPromise).rejects.toMatchObject({
      statusCode: 0,
      code: "API_NETWORK_ERROR",
      requestId: null,
      endpoint: "GET /me",
      responseBodyKind: "empty",
      originalErrorName: "TypeError",
      originalErrorMessage: "Failed to fetch",
      attemptCount: 4,
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("retries a transient network failure for workspace bootstrap reads", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createWorkspacesResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(listWorkspaces()).resolves.toEqual([{
      workspaceId: "workspace-1",
      name: "Default",
      createdAt: "2026-04-10T00:00:00.000Z",
      isSelected: true,
    }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/workspaces?limit=100");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/workspaces?limit=100");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /workspaces",
      attemptCount: 1,
      maximumAttemptCount: 4,
      nextAttemptCount: 2,
      originalErrorName: "TypeError",
      originalErrorMessage: "Failed to fetch",
    }));
  });

  it("retries a transient network failure for chat snapshot reads", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatSnapshot("session-1", "workspace-1")).resolves.toMatchObject({
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /chat",
      attemptCount: 1,
      maximumAttemptCount: 4,
      nextAttemptCount: 2,
      originalErrorName: "TypeError",
      originalErrorMessage: "Failed to fetch",
    }));
  });

  it("retries a transient network failure for sync pull requests", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const workspaceId = "99782554-9362-416c-93c7-0eb1d8079948";
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changes: [],
        nextHotChangeId: 42,
        hasMore: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pullSyncChanges(
      workspaceId,
      "installation-1",
      "web",
      "1.12.0",
      0,
      200,
    )).resolves.toEqual({
      changes: [],
      nextHotChangeId: 42,
      hasMore: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "POST /workspaces/{uuid}/sync/pull",
      attemptCount: 1,
    }));
  });

  it("retries session readiness for retry-enabled unsafe sync requests", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const workspaceId = "99782554-9362-416c-93c7-0eb1d8079948";
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changes: [],
        nextHotChangeId: 42,
        hasMore: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pullSyncChanges(
      workspaceId,
      "installation-1",
      "web",
      "1.12.0",
      0,
      200,
    )).resolves.toEqual({
      changes: [],
      nextHotChangeId: 42,
      hasMore: false,
    });

    const syncRequestInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`http://localhost:8080/v1/workspaces/${workspaceId}/sync/pull`);
    expect(new Headers(syncRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
    }));
  });

  it("retries session reload after auth recovery for retry-enabled requests", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatSnapshot("session-1", "workspace-1")).resolves.toMatchObject({
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/chat?sessionId=session-1&workspaceId=workspace-1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8080/v1/chat?sessionId=session-1&workspaceId=workspace-1");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
    }));
  });

  it("retries a transient network failure for idempotent chat run starts", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createStartChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(startChatRun({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "client-request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "UTC",
      uiLocale: "en",
    })).resolves.toMatchObject({
      accepted: true,
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "POST /chat",
      attemptCount: 1,
    }));
  });

  it("retries a transient network failure for explicit chat session creation", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTransportBackedChatSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "POST /chat/new",
      attemptCount: 1,
    }));
  });

  it("upgrades auth recovery retry mode for concurrent retry-enabled requests", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const refreshResponse = createDeferredResponsePromise();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockImplementationOnce(() => refreshResponse.promise)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    const nonRetryErrorPromise = stopChatRun("session-1", "workspace-1", null)
      .catch((error: unknown): unknown => error);
    await waitForFetchCallCount(fetchMock, 2);

    const retryPromise = getChatSnapshot("session-1", "workspace-1");
    await waitForFetchCallCount(fetchMock, 3);
    refreshResponse.resolve(new Response(null, { status: 200 }));

    await expect(retryPromise).resolves.toMatchObject({
      sessionId: "session-1",
    });
    await expect(nonRetryErrorPromise).resolves.toMatchObject({
      endpoint: "GET /me",
      attemptCount: 1,
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/chat/stop");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/chat?sessionId=session-1&workspaceId=workspace-1");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[6]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[7]?.[0]).toBe("http://localhost:8080/v1/chat?sessionId=session-1&workspaceId=workspace-1");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
    }));
  });

  it("upgrades active non-retry auth recovery before retry-enabled unsafe requests", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const workspaceId = "99782554-9362-416c-93c7-0eb1d8079948";
    const refreshResponse = createDeferredResponsePromise();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockImplementationOnce(() => refreshResponse.promise)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createSessionResponse(null))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changes: [],
        nextHotChangeId: 42,
        hasMore: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const nonRetryErrorPromise = requestJson("/me", { method: "GET" }, allowAuthRecovery)
      .catch((error: unknown): unknown => error);
    await waitForFetchCallCount(fetchMock, 2);

    const retryPromise = pullSyncChanges(
      workspaceId,
      "installation-1",
      "web",
      "1.12.0",
      0,
      200,
    );
    refreshResponse.resolve(new Response(null, { status: 200 }));

    await expect(retryPromise).resolves.toEqual({
      changes: [],
      nextHotChangeId: 42,
      hasMore: false,
    });
    await expect(nonRetryErrorPromise).resolves.toMatchObject({
      endpoint: "GET /me",
      attemptCount: 1,
    } satisfies Partial<ApiNetworkError>);

    const syncRequestInit = fetchMock.mock.calls[6]?.[1] as RequestInit | undefined;
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[6]?.[0]).toBe(`http://localhost:8080/v1/workspaces/${workspaceId}/sync/pull`);
    expect(new Headers(syncRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
    }));
  });

  it("raises a structured API network error after transient retry attempts are exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const snapshotPromise = getChatSnapshot("session-1", "workspace-1");

    await expect(snapshotPromise).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(snapshotPromise).rejects.toMatchObject({
      statusCode: 0,
      code: "API_NETWORK_ERROR",
      requestId: null,
      endpoint: "GET /chat",
      responseBodyKind: "empty",
      originalErrorName: "TypeError",
      originalErrorMessage: "Failed to fetch",
      attemptCount: 4,
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry mutating chat stop requests when network retry is not enabled", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", null)).rejects.toMatchObject({
      statusCode: 0,
      code: "API_NETWORK_ERROR",
      endpoint: "POST /chat/stop",
      attemptCount: 1,
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
