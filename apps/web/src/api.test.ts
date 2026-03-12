import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRedirectError,
  createLocalChatRequestBody,
  createWorkspace,
  getSession,
  listWorkspaces,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
} from "./api";

function createJsonResponse(statusCode: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createSessionPayload(csrfToken: string): Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  authTransport: string;
  csrfToken: string;
  profile: Readonly<{
    email: string;
    locale: string;
    createdAt: string;
  }>;
}> {
  return {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken,
    profile: {
      email: "test@example.com",
      locale: "en",
      createdAt: "2026-03-09T00:00:00.000Z",
    },
  };
}

function getHeaderValue(init: RequestInit | undefined, headerName: string): string | null {
  return new Headers(init?.headers).get(headerName);
}

describe("web auth recovery", () => {
  const redirectUrls: Array<string> = [];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    redirectUrls.length = 0;
    resetApiClientStateForTests();
    setNavigationHandlerForTests((url: string) => {
      redirectUrls.push(url);
    });
    window.history.replaceState({}, "", "/cards");
  });

  afterEach(() => {
    resetApiClientStateForTests();
    vi.unstubAllGlobals();
  });

  it("refreshes once and retries /me when bootstrap hits 401", async () => {
    let meCallCount = 0;
    let refreshCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        meCallCount += 1;
        if (meCallCount === 1) {
          return createJsonResponse(401, { error: "Authentication failed. Sign in again." });
        }

        return createJsonResponse(200, createSessionPayload("csrf-restored"));
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        refreshCallCount += 1;
        return createJsonResponse(200, { ok: true });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const session = await getSession();

    expect(session.csrfToken).toBe("csrf-restored");
    expect(meCallCount).toBe(3);
    expect(refreshCallCount).toBe(1);
    expect(redirectUrls).toEqual([]);
  });

  it("reloads /me after refresh so mutating retries use the new CSRF token", async () => {
    const seenCsrfTokens: Array<string | null> = [];
    let meCallCount = 0;
    let workspaceCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        meCallCount += 1;
        if (meCallCount === 1) {
          return createJsonResponse(200, createSessionPayload("csrf-old"));
        }

        return createJsonResponse(200, createSessionPayload("csrf-new"));
      }

      if (url === "http://localhost:8080/v1/workspaces") {
        workspaceCallCount += 1;
        seenCsrfTokens.push(getHeaderValue(init, "X-CSRF-Token"));
        if (workspaceCallCount === 1) {
          return createJsonResponse(401, { error: "Authentication failed. Sign in again." });
        }

        return createJsonResponse(200, {
          workspace: {
            workspaceId: "workspace-2",
            name: "Recovered",
            createdAt: "2026-03-09T00:00:00.000Z",
            isSelected: true,
          },
        });
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        return createJsonResponse(200, { ok: true });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await getSession();
    const workspace = await createWorkspace("Recovered");

    expect(workspace.workspaceId).toBe("workspace-2");
    expect(seenCsrfTokens).toEqual(["csrf-old", "csrf-new"]);
  });

  it("shares one refresh operation across concurrent 401 responses", async () => {
    let meCallCount = 0;
    let refreshCallCount = 0;
    let workspaceCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        meCallCount += 1;
        return createJsonResponse(200, createSessionPayload("csrf-shared"));
      }

      if (url === "http://localhost:8080/v1/workspaces?limit=100") {
        workspaceCallCount += 1;
        if (workspaceCallCount <= 2) {
          return createJsonResponse(401, { error: "Authentication failed. Sign in again." });
        }

        return createJsonResponse(200, {
          workspaces: [{
            workspaceId: "workspace-1",
            name: "Primary",
            createdAt: "2026-03-09T00:00:00.000Z",
            isSelected: true,
          }],
          nextCursor: null,
        });
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        refreshCallCount += 1;
        return createJsonResponse(200, { ok: true });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await getSession();
    const [firstWorkspaces, secondWorkspaces] = await Promise.all([listWorkspaces(), listWorkspaces()]);

    expect(firstWorkspaces).toHaveLength(1);
    expect(secondWorkspaces).toHaveLength(1);
    expect(refreshCallCount).toBe(1);
    expect(meCallCount).toBe(2);
  });

  it("redirects to auth with the full current route when refresh token is expired", async () => {
    window.history.replaceState({}, "", "/review?deck=1#card-2");

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/workspaces?limit=100") {
        return createJsonResponse(401, { error: "Authentication failed. Sign in again." });
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        return createJsonResponse(401, { error: "Sign in again." });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(listWorkspaces()).rejects.toBeInstanceOf(AuthRedirectError);
    expect(redirectUrls).toEqual([
      "http://localhost:8081/login?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Freview%3Fdeck%3D1%23card-2",
    ]);
  });

  it("does not attempt auth refresh for non-401 failures", async () => {
    let refreshCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/workspaces?limit=100") {
        return createJsonResponse(500, { error: "Server failed." });
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        refreshCallCount += 1;
        return createJsonResponse(200, { ok: true });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(listWorkspaces()).rejects.toMatchObject({
      message: "Server failed.",
      statusCode: 500,
    });
    expect(refreshCallCount).toBe(0);
    expect(redirectUrls).toEqual([]);
  });

  it("stops after one retry when the retried request still returns 401", async () => {
    let meCallCount = 0;
    let refreshCallCount = 0;
    let workspaceCallCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        meCallCount += 1;
        return createJsonResponse(200, createSessionPayload("csrf-reloaded"));
      }

      if (url === "http://localhost:8080/v1/workspaces?limit=100") {
        workspaceCallCount += 1;
        return createJsonResponse(401, { error: "Authentication failed. Sign in again." });
      }

      if (url === "http://localhost:8081/api/refresh-session") {
        refreshCallCount += 1;
        return createJsonResponse(200, { ok: true });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(listWorkspaces()).rejects.toMatchObject({
      message: "Authentication failed. Sign in again.",
      statusCode: 401,
    });
    expect(workspaceCallCount).toBe(2);
    expect(meCallCount).toBe(1);
    expect(refreshCallCount).toBe(1);
    expect(redirectUrls).toEqual([]);
  });
});

describe("createLocalChatRequestBody", () => {
  it("includes the required user context block payload", () => {
    expect(createLocalChatRequestBody(
      [{
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }],
      "gpt-5.4",
      "Europe/Madrid",
      {
        totalCards: 3,
      },
    )).toEqual({
      messages: [{
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }],
      model: "gpt-5.4",
      timezone: "Europe/Madrid",
      devicePlatform: "web",
      userContext: {
        totalCards: 3,
      },
    });
  });
});
