// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./endpointsTestSupport";
import {
  createChatSnapshotResponse,
  createJsonResponse,
  createLegacyChatConfigResponseValue,
  createNewChatSessionResponse,
  createStartChatRunResponse,
  createStopChatRunResponse,
} from "../ApiTestSupport";
import { primeSessionCsrfToken } from "../transport/transport";
import {
  createNewChatSession,
  getChatSnapshot,
  startChatRun,
  stopChatRun,
  transcribeChatAudio,
} from "./chat";

describe("chat API endpoints", () => {
  it("includes workspaceId and uiLocale in POST /chat requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStartChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await startChatRun({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    }));
  });

  it("includes workspaceId and uiLocale in POST /chat/new requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"));
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "es-ES");

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      uiLocale: "es-ES",
    }));
  });

  it("includes workspaceId in GET /chat requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getChatSnapshot("session-1", "workspace-1");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/chat");
    expect(requestUrl.searchParams.get("sessionId")).toBe("session-1");
    expect(requestUrl.searchParams.get("workspaceId")).toBe("workspace-1");
  });

  it("accepts legacy chat config metadata without exposing it in web state", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({
        sessionId: "session-1",
        conversationScopeId: "session-1",
        conversation: {
          messages: [],
          updatedAt: 1,
          mainContentInvalidationVersion: 0,
        },
        composerSuggestions: [],
        chatConfig: createLegacyChatConfigResponseValue(),
        activeRun: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatSnapshot("session-1", "workspace-1")).resolves.toMatchObject({
      sessionId: "session-1",
      chatConfig: {
        features: {
          dictationEnabled: true,
          attachmentsEnabled: true,
        },
      },
    });
  });

  it("accepts reduced POST /chat/stop responses without unused run identifiers", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", null)).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
    }));
  });

  it("includes runId in POST /chat/stop requests when known", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatRun("session-1", "workspace-1", "run-1")).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      runId: "run-1",
    }));
  });

  it("includes workspaceId in POST /chat/transcriptions requests", async () => {
    primeSessionCsrfToken("csrf-token-1");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "hello",
        sessionId: "session-1",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeChatAudio(
      new Blob(["audio"], { type: "audio/webm" }),
      "web",
      "session-1",
      "workspace-1",
    );

    const chatRequestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const formData = chatRequestInit?.body;
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) {
      throw new Error("Expected FormData");
    }

    expect(formData.get("sessionId")).toBe("session-1");
    expect(formData.get("workspaceId")).toBe("workspace-1");
    expect(formData.get("source")).toBe("web");
    expect(formData.get("file")).toBeInstanceOf(File);
  });
});
