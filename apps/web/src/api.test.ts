import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRedirectError,
  createAIChatRequestBody,
  createWorkspace,
  deleteWorkspace,
  getSession,
  listWorkspaces,
  loadWorkspaceDeletePreview,
  primeSessionCsrfToken,
  renameWorkspace,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
  transcribeChatAudio,
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

  it("renames a workspace through the human management endpoint", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        return createJsonResponse(200, createSessionPayload("csrf-rename"));
      }

      if (url === "http://localhost:8080/v1/workspaces/workspace-1/rename") {
        expect(getHeaderValue(init, "X-CSRF-Token")).toBe("csrf-rename");
        return createJsonResponse(200, {
          workspace: {
            workspaceId: "workspace-1",
            name: "Renamed workspace",
            createdAt: "2026-03-09T00:00:00.000Z",
            isSelected: true,
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await getSession();
    const workspace = await renameWorkspace("workspace-1", "Renamed workspace");

    expect(workspace.name).toBe("Renamed workspace");
  });

  it("loads the delete preview for a workspace", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/workspaces/workspace-1/delete-preview") {
        return createJsonResponse(200, {
          workspaceId: "workspace-1",
          workspaceName: "Primary",
          activeCardCount: 7,
          confirmationText: "delete workspace",
          isLastAccessibleWorkspace: false,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const preview = await loadWorkspaceDeletePreview("workspace-1");

    expect(preview).toEqual({
      workspaceId: "workspace-1",
      workspaceName: "Primary",
      activeCardCount: 7,
      confirmationText: "delete workspace",
      isLastAccessibleWorkspace: false,
    });
  });

  it("deletes a workspace and returns the selected replacement workspace", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8080/v1/me") {
        return createJsonResponse(200, createSessionPayload("csrf-delete"));
      }

      if (url === "http://localhost:8080/v1/workspaces/workspace-1/delete") {
        expect(getHeaderValue(init, "X-CSRF-Token")).toBe("csrf-delete");
        return createJsonResponse(200, {
          ok: true,
          deletedWorkspaceId: "workspace-1",
          deletedCardsCount: 4,
          workspace: {
            workspaceId: "workspace-2",
            name: "Replacement",
            createdAt: "2026-03-09T00:00:00.000Z",
            isSelected: true,
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await getSession();
    const response = await deleteWorkspace("workspace-1", "delete workspace");

    expect(response.deletedWorkspaceId).toBe("workspace-1");
    expect(response.workspace.workspaceId).toBe("workspace-2");
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

describe("createAIChatRequestBody", () => {
  it("includes the required user context block payload", () => {
    expect(createAIChatRequestBody(
      [{
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }],
      "gpt-5.4",
      "Europe/Madrid",
      "chat-session-1",
      "container-1",
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
      chatSessionId: "chat-session-1",
      codeInterpreterContainerId: "container-1",
      userContext: {
        totalCards: 3,
      },
    });
  });
});

describe("transcribeChatAudio", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetApiClientStateForTests();
    primeSessionCsrfToken("csrf-dictation");
  });

  afterEach(() => {
    resetApiClientStateForTests();
    vi.unstubAllGlobals();
  });

  it("sends only file and source in the multipart request", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8080/v1/chat/transcriptions");
      expect(init?.method).toBe("POST");
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const formData = body as FormData;
      expect(formData.get("source")).toBe("web");
      expect(formData.get("durationSeconds")).toBeNull();
      const file = formData.get("file");
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe("chat-dictation.webm");
      expect((file as File).type).toBe("audio/webm");
      return createJsonResponse(200, { text: "dictated text" });
    });

    const transcript = await transcribeChatAudio(
      new Blob(["dictation"], { type: "audio/webm" }),
      "web"
    );

    expect(transcript).toBe("dictated text");
  });
});
