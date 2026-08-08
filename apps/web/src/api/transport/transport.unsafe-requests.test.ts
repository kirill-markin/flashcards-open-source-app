// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createNewChatSessionResponse,
  createSessionResponse,
} from "../ApiTestSupport";
import { stopChatRun } from "../endpoints/chat";
import { ApiNetworkError } from "./errors";
import { primeSessionCsrfToken } from "./transport";
import {
  createFailingJsonResponse,
  createTransportBackedChatSession,
} from "./transportTestSupport";

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

  it("retries a failed stale-CSRF response body read with the shared network budget", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingJsonResponse(
        new TypeError("Load failed"),
        "csrf-request-1",
        403,
      ))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTransportBackedChatSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledWith("API transport retry", expect.objectContaining({
      endpoint: "POST /chat/new",
      attemptCount: 1,
      source: "response_body",
      statusCode: 403,
      requestId: "csrf-request-1",
    }));
  });

  it("does not retry a failed stale-CSRF response body read without network retry", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createFailingJsonResponse(
        new TypeError("Load failed"),
        "csrf-request-no-retry",
        403,
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", null)).rejects.toMatchObject({
      statusCode: 403,
      code: "API_NETWORK_ERROR",
      requestId: "csrf-request-no-retry",
      endpoint: "POST /chat/stop",
      attemptCount: 1,
      source: "response_body",
    } satisfies Partial<ApiNetworkError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
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
