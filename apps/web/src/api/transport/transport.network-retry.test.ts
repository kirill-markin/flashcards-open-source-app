// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createChatSnapshotResponse,
  createNewChatSessionResponse,
  createSessionResponse,
  createStartChatRunResponse,
} from "../ApiTestSupport";
import {
  getChatSnapshot,
  startChatRun,
  stopChatRun,
} from "../endpoints/chat";
import { pullSyncChanges } from "../endpoints/sync";
import { listWorkspaces } from "../endpoints/workspaces";
import { ApiNetworkError } from "./errors";
import {
  allowAuthRecovery,
  allowAuthRecoveryWithTransientNetworkRetry,
  getSession,
  primeSessionCsrfToken,
  requestJson,
} from "./transport";
import {
  createDeferredResponsePromise,
  createFailingJsonResponse,
  createTransportBackedChatSession,
  createWorkspacesResponse,
  waitForFetchCallCount,
} from "./transportTestSupport";

// Frozen test input — intentionally not the real app version; do not bump on release (see docs/version-bump.md).
const TEST_APP_VERSION = "1.0.0";

describe("API transport network retry", () => {
  it("cancels a pending transient network retry wait", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const abortController = new AbortController();
    const abortReason = new Error("Media upload lifecycle discarded during transport retry");
    const requestPromise = requestJson(
      "/media-upload-retry-cancellation",
      {
        method: "GET",
        signal: abortController.signal,
      },
      allowAuthRecoveryWithTransientNetworkRetry,
    );

    await waitForFetchCallCount(fetchMock, 1);
    for (let attemptCount = 0; attemptCount < 20 && consoleWarnSpy.mock.calls.length === 0; attemptCount += 1) {
      await Promise.resolve();
    }
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    abortController.abort(abortReason);

    await expect(requestPromise).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it("retries a response body read failure with response metadata", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingJsonResponse(new TypeError("Load failed"), "request-1", 200))
      .mockResolvedValueOnce(createSessionResponse(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toMatchObject({
      userId: "user-1",
      selectedWorkspaceId: "workspace-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "GET /me",
      attemptCount: 1,
      maximumAttemptCount: 4,
      nextAttemptCount: 2,
      source: "response_body",
      statusCode: 200,
      requestId: "request-1",
      originalErrorName: "TypeError",
      originalErrorMessage: "Load failed",
    }));
  });

  it("shares one retry budget across fetch and response body failures", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingJsonResponse(new TypeError("Load failed"), "request-1", 200))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(createFailingJsonResponse(new TypeError("Load failed"), "request-3", 200))
      .mockResolvedValueOnce(createSessionResponse(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toMatchObject({
      userId: "user-1",
      selectedWorkspaceId: "workspace-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleWarnSpy.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        source: "response_body",
        requestId: "request-1",
      }),
      expect.objectContaining({
        attemptCount: 2,
        source: "fetch",
        requestId: null,
      }),
      expect.objectContaining({
        attemptCount: 3,
        source: "response_body",
        requestId: "request-3",
      }),
    ]);
  });

  it("raises a structured API network error after response body retry attempts are exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockImplementation(() => Promise.resolve(
        createFailingJsonResponse(new TypeError("Load failed"), "request-terminal", 200),
      ));
    vi.stubGlobal("fetch", fetchMock);
    const sessionPromise = getSession();

    await expect(sessionPromise).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(sessionPromise).rejects.toMatchObject({
      statusCode: 200,
      code: "API_NETWORK_ERROR",
      requestId: "request-terminal",
      endpoint: "GET /me",
      responseBodyKind: "empty",
      originalErrorName: "TypeError",
      originalErrorMessage: "Load failed",
      attemptCount: 4,
      source: "response_body",
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry response body failures when network retry is disabled", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingJsonResponse(
        new TypeError("Load failed"),
        "request-no-retry",
        200,
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson(
      "/response-body-no-retry",
      { method: "GET" },
      allowAuthRecovery,
    )).rejects.toMatchObject({
      statusCode: 200,
      code: "API_NETWORK_ERROR",
      requestId: "request-no-retry",
      endpoint: "GET /response-body-no-retry",
      attemptCount: 1,
      source: "response_body",
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
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

    await expect(getChatSnapshot("session-1", "workspace-1", new AbortController().signal)).resolves.toMatchObject({
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
      TEST_APP_VERSION,
      0,
      200,
      false,
      new AbortController().signal,
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
      TEST_APP_VERSION,
      0,
      200,
      false,
      new AbortController().signal,
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

    await expect(getChatSnapshot("session-1", "workspace-1", new AbortController().signal)).resolves.toMatchObject({
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

    const retryPromise = getChatSnapshot("session-1", "workspace-1", new AbortController().signal);
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
      TEST_APP_VERSION,
      0,
      200,
      false,
      new AbortController().signal,
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
    const snapshotPromise = getChatSnapshot("session-1", "workspace-1", new AbortController().signal);

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
