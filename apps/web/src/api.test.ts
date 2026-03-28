import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiContractError,
  AuthRedirectError,
  createWorkspace,
  deleteWorkspace,
  getChatSnapshot,
  getSession,
  listWorkspaces,
  loadWorkspaceDeletePreview,
  primeSessionCsrfToken,
  pullSyncChanges,
  renameWorkspace,
  resetChatSession,
  resetApiClientStateForTests,
  startChatRun,
  stopChatRun,
  setNavigationHandlerForTests,
  transcribeChatAudio,
} from "./api";
import { defaultChatConfig } from "./chat/chatConfig";

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

type TestCardPayload = Readonly<{
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: "medium";
  dueAt: null;
  createdAt: string;
  reps: number;
  lapses: number;
  fsrsCardState: "new";
  fsrsStepIndex: null;
  fsrsStability: null;
  fsrsDifficulty: null;
  fsrsLastReviewedAt: null;
  fsrsScheduledDays: null;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: null;
}>;

type TestSyncPullPayload = Readonly<{
  changes: ReadonlyArray<Readonly<{
    changeId: number;
    entityType: "card";
    entityId: string;
    action: "upsert";
    payload: TestCardPayload;
  }>>;
  nextHotChangeId: number;
  hasMore: boolean;
}>;

type TestChatSnapshotPayload = Readonly<{
  sessionId: string;
  runState: "idle";
  updatedAt: number;
  mainContentInvalidationVersion: number;
  chatConfig: typeof defaultChatConfig;
  messages: ReadonlyArray<Readonly<{
    role: "assistant";
    content: ReadonlyArray<Readonly<{
      type: "tool_call";
      id: string;
      name: string;
      status: "completed";
      providerStatus: null;
      input: null;
      output: null;
      streamPosition: Readonly<{
        itemId: string;
        outputIndex: number;
        contentIndex: null;
        sequenceNumber: null;
      }>;
    }>>;
    timestamp: number;
    isError: boolean;
    isStopped: boolean;
  }>>;
}>;

function createCardPayload(): TestCardPayload {
  return {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    tags: ["tag-1"],
    effortLevel: "medium",
    dueAt: null,
    createdAt: "2026-03-09T00:00:00.000Z",
    reps: 1,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-09T00:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-09T00:00:00.000Z",
    deletedAt: null,
  };
}

function createSyncPullPayload(): TestSyncPullPayload {
  return {
    changes: [{
      changeId: 1,
      entityType: "card",
      entityId: "card-1",
      action: "upsert",
      payload: createCardPayload(),
    }],
    nextHotChangeId: 2,
    hasMore: false,
  };
}

function createChatSnapshotPayload(): TestChatSnapshotPayload {
  return {
    sessionId: "session-1",
    runState: "idle",
    updatedAt: 1,
    mainContentInvalidationVersion: 0,
    chatConfig: defaultChatConfig,
    messages: [{
      role: "assistant",
      content: [{
        type: "tool_call",
        id: "tool-1",
        name: "sql",
        status: "completed",
        providerStatus: null,
        input: null,
        output: null,
        streamPosition: {
          itemId: "item-1",
          outputIndex: 0,
          contentIndex: null,
          sequenceNumber: null,
        },
      }],
      timestamp: 1,
      isError: false,
      isStopped: false,
    }],
  };
}

async function captureRejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
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

describe("api contract validation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetApiClientStateForTests();
    primeSessionCsrfToken("csrf-contract");
  });

  afterEach(() => {
    resetApiClientStateForTests();
    vi.unstubAllGlobals();
  });

  it("ignores extra fields in /me while returning only the declared shape", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...createSessionPayload("csrf-extra"),
      extraTopLevel: "ignored",
      profile: {
        ...createSessionPayload("csrf-extra").profile,
        extraNested: true,
      },
    }));

    const session = await getSession();

    expect(session).toEqual(createSessionPayload("csrf-extra"));
  });

  it("ignores extra fields in paginated workspace responses", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      workspaces: [{
        workspaceId: "workspace-1",
        name: "Primary",
        createdAt: "2026-03-09T00:00:00.000Z",
        isSelected: true,
        ignoredField: "ignored",
      }],
      nextCursor: null,
      ignoredTopLevel: 1,
    }));

    const workspaces = await listWorkspaces();

    expect(workspaces).toEqual([{
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-09T00:00:00.000Z",
      isSelected: true,
    }]);
  });

  it("ignores extra fields in nested chat snapshots", async () => {
    const snapshotPayload = createChatSnapshotPayload();
    const messagePayload = snapshotPayload.messages[0];
    const toolCallPayload = messagePayload.content[0];

    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...snapshotPayload,
      ignoredTopLevel: "ignored",
      chatConfig: {
        ...defaultChatConfig,
        ignoredConfigField: true,
      },
      messages: [{
        ...messagePayload,
        ignoredMessageField: "ignored",
        content: [{
          ...toolCallPayload,
          ignoredContentField: "ignored",
          streamPosition: {
            ...toolCallPayload.streamPosition,
            ignoredStreamField: "ignored",
          },
        }],
      }],
    }));

    const snapshot = await getChatSnapshot();

    expect(snapshot).toEqual(snapshotPayload);
  });

  it("fails when a required top-level session field is missing", async () => {
    const payload = createSessionPayload("csrf-missing-top-level");
    const { userId: _ignoredUserId, ...invalidPayload } = payload;
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, invalidPayload));

    const error = await captureRejectedError(getSession());

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({
      message: "Invalid API response for GET /me: userId must be string",
    });
  });

  it("fails when a required nested session field is missing", async () => {
    const payload = createSessionPayload("csrf-missing-nested");
    const { locale: _ignoredLocale, ...invalidProfile } = payload.profile;
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...payload,
      profile: invalidProfile,
    }));

    const error = await captureRejectedError(getSession());

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({
      message: "Invalid API response for GET /me: profile.locale must be string",
    });
  });

  it("fails when a sync response contains a wrong primitive type", async () => {
    const payload = createSyncPullPayload();
    const change = payload.changes[0] as Readonly<Record<string, unknown>>;
    const cardPayload = change.payload as Readonly<Record<string, unknown>>;
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...payload,
      changes: [{
        ...change,
        payload: {
          ...cardPayload,
          frontText: 42,
        },
      }],
    }));

    const error = await captureRejectedError(
      pullSyncChanges("workspace-1", "device-1", "web", "1.0.0", 0, 100),
    );

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({
      message: "Invalid API response for POST /workspaces/workspace-1/sync/pull: changes[0].payload.frontText must be string",
    });
  });

  it("fails when a chat response contains an invalid enum value", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...createChatSnapshotPayload(),
      runState: "paused",
    }));

    const error = await captureRejectedError(getChatSnapshot());

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({
      message: "Invalid API response for GET /chat: runState must be one of \"idle\", \"running\", \"interrupted\"",
    });
  });

  it("fails when a chat response contains an invalid content item shape", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ...createChatSnapshotPayload(),
      messages: [{
        role: "assistant",
        content: [{
          type: "text",
        }],
        timestamp: 1,
        isError: false,
        isStopped: false,
      }],
    }));

    const error = await captureRejectedError(getChatSnapshot());

    expect(error).toBeInstanceOf(ApiContractError);
    expect(error).toMatchObject({
      message: "Invalid API response for GET /chat: messages[0].content[0].text must be string",
    });
  });
});

describe("backend-owned chat api helpers", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetApiClientStateForTests();
    primeSessionCsrfToken("csrf-chat");
  });

  afterEach(() => {
    resetApiClientStateForTests();
    vi.unstubAllGlobals();
  });

  it("loads the latest backend snapshot through GET /chat", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      sessionId: "session-1",
      runState: "idle",
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
      chatConfig: defaultChatConfig,
      messages: [],
    }));

    const snapshot = await getChatSnapshot();

    expect(snapshot.sessionId).toBe("session-1");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/chat", expect.any(Object));
  });

  it("starts a backend-owned chat run with the compact request shape", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ok: true,
      sessionId: "session-1",
      runId: "run-1",
      runState: "running",
      chatConfig: defaultChatConfig,
    }));

    await startChatRun({
      sessionId: "session-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/chat", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        sessionId: "session-1",
        content: [{ type: "text", text: "hello" }],
        timezone: "Europe/Madrid",
      }),
    }));
  });

  it("resets the backend-owned session through DELETE /chat", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ok: true,
      sessionId: "session-2",
      chatConfig: defaultChatConfig,
    }));

    const response = await resetChatSession("session-1");

    expect(response.sessionId).toBe("session-2");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/chat?sessionId=session-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("stops the backend-owned run through POST /chat/stop", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {
      ok: true,
      sessionId: "session-1",
      runId: "run-1",
      stopped: true,
      stillRunning: false,
    }));

    const response = await stopChatRun("session-1");

    expect(response.stopped).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/chat/stop", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sessionId: "session-1" }),
    }));
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

  it("sends file, source, and optional sessionId in the multipart request", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8080/v1/chat/transcriptions");
      expect(init?.method).toBe("POST");
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const formData = body as FormData;
      expect(formData.get("source")).toBe("web");
      expect(formData.get("sessionId")).toBe("session-1");
      expect(formData.get("durationSeconds")).toBeNull();
      const file = formData.get("file");
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe("chat-dictation.webm");
      expect((file as File).type).toBe("audio/webm");
      return createJsonResponse(200, { text: "dictated text", sessionId: "session-2" });
    });

    const transcript = await transcribeChatAudio(
      new Blob(["dictation"], { type: "audio/webm" }),
      "web",
      "session-1",
    );

    expect(transcript).toEqual({
      text: "dictated text",
      sessionId: "session-2",
    });
  });
});
