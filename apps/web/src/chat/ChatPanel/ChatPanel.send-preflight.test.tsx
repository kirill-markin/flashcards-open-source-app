// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createChatActiveRun,
  createChatSnapshot,
  createNewChatSessionMock,
  queryChatComposerInput,
  readStoredDraftInputText,
  setupChatPanelTest,
  startChatRunMock,
  useAppDataMock,
} from "./ChatPanelTestSupport";
import { createVerifiedWorkspaceAppDataMock } from "./ChatPanelTestFixtures";
import {
  createChatDraftContent,
  loadChatDraftWorkspaceState,
  replaceChatDraftForSession,
  storeChatDraftWorkspaceState,
} from "../composer/chatDraftStorage";

const {
  flushAsync,
  getContainer,
  hideChatPanel,
  renderChatPanel,
  renderChatPanelStrictMode,
  sendMessage,
  unmountChatPanel,
} = setupChatPanelTest();

describe("ChatPanel send preflight lifecycle", () => {
  it("sends only one POST /chat while async preflight is in progress", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await sendMessage("hello");
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("clears the composer immediately while turn acceptance is still in flight", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("");

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps a newer same-session draft when an older accepted send finishes", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation((requestBody) => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: createChatActiveRun(),
        }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("old draft");
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("old draft");

    const newerDrafts = replaceChatDraftForSession(
      loadChatDraftWorkspaceState("workspace-1"),
      sessionId as string,
      createChatDraftContent("new draft", []),
    );
    storeChatDraftWorkspaceState("workspace-1", newerDrafts);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "flashcards-chat-drafts::workspace-1" }));
      await Promise.resolve();
    });

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("new draft");
    expect(queryChatComposerInput(getContainer())?.value).toBe("new draft");
  });

  it("keeps starting a new chat enabled while turn acceptance is still in flight", async () => {
    let resolveStartRun: (() => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStartRun = () => resolve({
        ...createChatSnapshot({ activeRun: createChatActiveRun() }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("hello");
    await flushAsync();

    const newButton = [...getContainer().querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "New");
    expect(newButton).not.toBeUndefined();
    expect((newButton as HTMLButtonElement).disabled).toBe(false);

    resolveStartRun?.();
    await flushAsync();
    await flushAsync();
  });

  it("keeps the stored draft through a runSync preflight failure", async () => {
    let rejectRunSync: ((error: Error) => void) | null = null;
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: vi.fn(() => new Promise((_, reject) => {
        rejectRunSync = (error) => reject(error);
      })),
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeFailure = queryChatComposerInput(getContainer());
    expect(textareaBeforeFailure?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    rejectRunSync?.(new Error("sync failed"));
    await flushAsync();
    await flushAsync();

    const textareaAfterFailure = queryChatComposerInput(getContainer());
    expect(textareaAfterFailure?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
  });

  it("keeps the draft when startRun fails before the server accepts the turn", async () => {
    let rejectStartRun: ((error: Error) => void) | null = null;
    startChatRunMock.mockImplementation(() => new Promise((_, reject) => {
      rejectStartRun = (error) => reject(error);
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    expect((queryChatComposerInput(getContainer()))?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    rejectStartRun?.(new Error("Request failed with status 500"));
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("keeps the draft when a rejected send settles under StrictMode", async () => {
    startChatRunMock.mockRejectedValueOnce(new Error("Request failed with status 500"));

    await renderChatPanelStrictMode();
    await flushAsync();
    await flushAsync();

    await sendMessage("keep this strict-mode draft");
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea?.value).toBe("keep this strict-mode draft");
    expect(getContainer().querySelector(".chat-msg")).toBeNull();
    expect(getContainer().querySelector('[role="dialog"]')).not.toBeNull();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("restores the stored draft after an app remount while turn acceptance is still pending", async () => {
    startChatRunMock.mockImplementation(() => new Promise(() => undefined));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await sendMessage("keep this draft");

    const textareaBeforeRemount = queryChatComposerInput(getContainer());
    expect(textareaBeforeRemount?.value).toBe("");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");

    await unmountChatPanel();
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterRemount = queryChatComposerInput(getContainer());
    expect(textareaAfterRemount?.value).toBe("keep this draft");
    expect(readStoredDraftInputText("workspace-1", sessionId as string)).toBe("keep this draft");
  });

  it("clears a first provisioned-session draft when the panel closes before turn acceptance", async () => {
    let resolveAcceptedRun: (() => void) | null = null;
    createNewChatSessionMock.mockRejectedValueOnce(new Error("Initial chat session failed"));
    startChatRunMock.mockImplementationOnce((requestBody) => new Promise((resolve) => {
      resolveAcceptedRun = () => resolve({
        ...createChatSnapshot({
          sessionId: requestBody.sessionId,
          conversationScopeId: requestBody.sessionId,
          activeRun: createChatActiveRun(),
        }),
        accepted: true,
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    expect(getContainer().textContent).toContain("Chat refresh failed.");

    await sendMessage("clear this first provisioned draft");
    await flushAsync();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    const provisionedSessionId = createNewChatSessionMock.mock.calls[1]?.[0];
    expect(typeof provisionedSessionId).toBe("string");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(readStoredDraftInputText("workspace-1", provisionedSessionId as string)).toBe("clear this first provisioned draft");

    await hideChatPanel();

    resolveAcceptedRun?.();
    await flushAsync();
    await flushAsync();

    expect(readStoredDraftInputText("workspace-1", provisionedSessionId as string)).toBeNull();

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textareaAfterAcceptedRun = queryChatComposerInput(getContainer());
    expect(textareaAfterAcceptedRun?.value).toBe("");
  });
});
