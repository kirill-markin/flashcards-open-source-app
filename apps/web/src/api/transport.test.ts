// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBrowserReauthRequired } from "../accountDeletion";
import { ApiContractError } from "../apiContracts/core";
import { persistLocalePreference } from "../i18n/runtime";
import type { NewChatSessionResponse } from "../types";
import {
  createNewChatSessionResponse,
  createSessionResponse,
  createStorageMock,
  expectLocalBrowserStatePreserved,
  expectLocalBrowserStatePreservedForReauth,
  mockBlockedDeleteDatabase,
  seedLocalBrowserState,
  setNavigatorLanguages,
} from "./ApiTestSupport";
import { createNewChatSession } from "./chat";
import { ApiError, AuthRedirectError } from "./errors";
import {
  getSession,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
} from "./transport";

async function createTransportBackedChatSession(sessionId: string): Promise<NewChatSessionResponse> {
  return createNewChatSession(sessionId, "workspace-1", "en");
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
    const deleteDatabaseSpy = mockBlockedDeleteDatabase();
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
