// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { isBrowserReauthRequired } from "../../accountDeletion";
import { ApiContractError } from "../../apiContracts/core";
import { persistLocalePreference } from "../../i18n/runtime";
import {
  createNewChatSessionResponse,
  createSessionResponse,
  expectLocalBrowserStatePreserved,
  expectLocalBrowserStatePreservedForReauth,
  seedLocalBrowserState,
  setNavigatorLanguages,
  spyOnDeleteDatabase,
} from "../ApiTestSupport";
import { ApiError, AuthRedirectError } from "./errors";
import {
  getSession,
  primeSessionCsrfToken,
  setNavigationHandlerForTests,
} from "./transport";
import { createTransportBackedChatSession } from "./transportTestSupport";

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

  it("reconciles a session when every refresh response is lost after server-side success", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTransportBackedChatSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.slice(1, 4).map((call) => call[0])).toEqual([
      "http://localhost:8081/api/refresh-session",
      "http://localhost:8081/api/refresh-session",
      "http://localhost:8081/api/refresh-session",
    ]);
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const retriedRequestInit = fetchMock.mock.calls[5]?.[1] as RequestInit | undefined;
    expect(new Headers(retriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
  });

  it("preserves the original refresh network error when reconciliation remains unauthorized", async () => {
    seedLocalBrowserState();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toMatchObject({
      statusCode: 0,
      message: "The auth service is unavailable. Try again. (/api/refresh-session; Load failed)",
      code: null,
      requestId: null,
      endpoint: "POST /api/refresh-session",
      responseBodyKind: "empty",
    } satisfies Partial<ApiError>);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.slice(4).map((call) => call[0])).toEqual([
      "http://localhost:8080/v1/me",
      "http://localhost:8080/v1/me",
      "http://localhost:8080/v1/me",
    ]);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(redirectedUrl).toBe("");
    expectLocalBrowserStatePreserved();
    expect(isBrowserReauthRequired()).toBe(false);
  });

  it("shares refresh reconciliation across concurrent callers", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const sessions = await Promise.all([getSession(), getSession()]);

    expect(sessions).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.slice(2, 5).map((call) => call[0])).toEqual([
      "http://localhost:8081/api/refresh-session",
      "http://localhost:8081/api/refresh-session",
      "http://localhost:8081/api/refresh-session",
    ]);
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls.slice(6).map((call) => call[0])).toEqual([
      "http://localhost:8080/v1/me",
      "http://localhost:8080/v1/me",
    ]);
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
