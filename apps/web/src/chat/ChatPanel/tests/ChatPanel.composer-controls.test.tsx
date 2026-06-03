// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createChatActiveRun,
  createChatPanelDragEnterEvent,
  createChatSnapshot,
  createDropEvent,
  createNewChatSessionMock,
  dispatchChatPanelDragEvent,
  getChatSnapshotMock,
  binaryPendingAttachmentExceedsSizeLimitMock,
  prepareAttachmentMock,
  queryChatAttachButton,
  queryChatComposerInput,
  queryChatComposerState,
  queryChatMicrophoneButton,
  queryChatSendButton,
  queryChatStopButton,
  readStoredDraftPendingAttachmentCount,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
  stopChatRunMock,
  transcribeChatAudioMock,
  useAppDataMock,
} from "./support/ChatPanelTestSupport";
import { createVerifiedWorkspaceAppDataMock } from "./support/ChatPanelTestFixtures";
import { getChatComposerCapabilities } from "../../composer/chatComposerState";

const {
  clickMicrophone,
  clickStop,
  flushAsync,
  getAlertMock,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

function createChatConfigWithAttachmentsEnabled(
  attachmentsEnabled: boolean,
): ReturnType<typeof createChatSnapshot>["chatConfig"] {
  const chatConfig = createChatSnapshot().chatConfig;
  return {
    ...chatConfig,
    features: {
      ...chatConfig.features,
      attachmentsEnabled,
    },
  };
}

describe("ChatPanel composer controls", () => {
  it("includes an explicit sessionId in the first dictation upload", async () => {
    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickMicrophone();
    await flushAsync();

    await clickMicrophone();
    await flushAsync();
    await flushAsync();

    expect(transcribeChatAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeChatAudioMock.mock.calls[0]?.[2]).toBe(createNewChatSessionMock.mock.calls[0]?.[0]);
  });

  it("keeps draft preparation controls enabled while an assistant run is active", async () => {
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      activeRun: createChatActiveRun(),
    }));
    prepareAttachmentMock.mockResolvedValue({
      type: "binary",
      fileName: "next-draft.txt",
      mediaType: "text/plain",
      base64Data: "bmV4dA==",
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const composerState = queryChatComposerState(getContainer());
    const textarea = queryChatComposerInput(getContainer());
    const attachButton = queryChatAttachButton(getContainer());
    const microphoneButton = queryChatMicrophoneButton(getContainer());
    const stopButton = queryChatStopButton(getContainer());
    const sendButton = queryChatSendButton(getContainer());

    expect(composerState?.getAttribute("data-composer-action")).toBe("stop");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(false);
    expect(microphoneButton).not.toBeNull();
    expect(microphoneButton?.disabled).toBe(false);
    expect(stopButton).not.toBeNull();
    expect(sendButton).toBeNull();

    await setTextareaValue(textarea as HTMLTextAreaElement, "next draft");
    await flushAsync();
    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(new File(["next"], "next-draft.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).toHaveBeenCalledTimes(1);
    expect(textarea?.value).toBe("next draft");
    expect(getContainer().textContent).toContain("next-draft.txt");
  });

  it("locks draft preparation controls while an active assistant run is stopping", async () => {
    let resolveStopRun: (() => void) | null = null;
    stopChatRunMock.mockImplementation(() => new Promise((resolve) => {
      resolveStopRun = () => resolve({
        sessionId: "session-1",
        stopped: true,
        stillRunning: false,
      });
    }));
    getChatSnapshotMock.mockResolvedValue(createChatSnapshot({
      activeRun: createChatActiveRun(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await clickStop();
    await flushAsync();

    expect(stopChatRunMock).toHaveBeenCalledWith("session-1", "workspace-1", "run-1");

    const composerState = queryChatComposerState(getContainer());
    const textarea = queryChatComposerInput(getContainer());
    const attachButton = queryChatAttachButton(getContainer());
    const microphoneButton = queryChatMicrophoneButton(getContainer());
    const stopButton = queryChatStopButton(getContainer());
    const getUserMediaMock = navigator.mediaDevices?.getUserMedia as ReturnType<typeof vi.fn>;

    expect(composerState?.getAttribute("data-composer-state")).toBe("stopping");
    expect(composerState?.getAttribute("data-stopping")).toBe("true");
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(true);
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);
    expect(microphoneButton).not.toBeNull();
    expect(microphoneButton?.disabled).toBe(true);
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(true);

    await clickMicrophone();
    await flushAsync();

    expect(getUserMediaMock).not.toHaveBeenCalled();

    const file = new File(["stopping"], "stopping.txt", { type: "text/plain" });
    await dispatchChatPanelDragEvent(getContainer(), createChatPanelDragEnterEvent(file));

    expect(getContainer().querySelector(".chat-drop-overlay")).toBeNull();

    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(file));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();

    resolveStopRun?.();
    await flushAsync();
  });

  it("keeps active recording stoppable when dictation becomes disabled", () => {
    const capabilities = getChatComposerCapabilities({
      areAttachmentsEnabled: true,
      dictationState: "recording",
      isChatActionLocked: false,
      isChatConversationReadyForAttachments: true,
      isDictationEnabled: false,
      isStopping: false,
      sendPhase: "idle",
    });

    expect(capabilities.canStartDictation).toBe(false);
    expect(capabilities.isDictationButtonDisabled).toBe(false);
  });

  it("ignores dropped files when attachments are disabled by chat config", async () => {
    const chatConfig = createChatConfigWithAttachmentsEnabled(false);
    createNewChatSessionMock.mockImplementation(async (sessionId: string) => ({
      ok: true,
      sessionId,
      composerSuggestions: [],
      chatConfig,
    }));
    getChatSnapshotMock.mockImplementation(async (sessionId: string) => createChatSnapshot({
      sessionId,
      conversationScopeId: sessionId,
      chatConfig,
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const attachButton = queryChatAttachButton(getContainer());
    const file = new File(["disabled"], "disabled.txt", { type: "text/plain" });
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);

    await dispatchChatPanelDragEvent(getContainer(), createChatPanelDragEnterEvent(file));

    expect(getContainer().querySelector(".chat-drop-overlay")).toBeNull();

    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(file));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).not.toContain("disabled.txt");
  });

  it("keeps the draft unchanged when a prepared attachment exceeds the client limit", async () => {
    prepareAttachmentMock.mockResolvedValue({
      type: "binary",
      fileName: "large.txt",
      mediaType: "text/plain",
      base64Data: "large",
    });
    binaryPendingAttachmentExceedsSizeLimitMock.mockReturnValue(true);

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();
    await setTextareaValue(textarea as HTMLTextAreaElement, "draft stays");
    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(new File(["large"], "large.txt", { type: "text/plain" })));
    await flushAsync();

    expect(getContainer().textContent).not.toContain("large.txt");
    expect(textarea?.value).toBe("draft stays");
    expect(getAlertMock()).toHaveBeenCalledWith("Message is too large. AI chat can’t send this much content at once. Remove one or more attachments, choose a smaller file or photo, or split the request and try again.");
  });

  it("keeps the draft unchanged when an existing attachment exceeds the send limit", async () => {
    prepareAttachmentMock.mockResolvedValue({
      type: "binary",
      fileName: "restored.txt",
      mediaType: "text/plain",
      base64Data: "restored",
    });

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const textarea = queryChatComposerInput(getContainer());
    expect(textarea).not.toBeNull();
    await setTextareaValue(textarea as HTMLTextAreaElement, "draft stays");
    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(new File(["restored"], "restored.txt", { type: "text/plain" })));
    await flushAsync();
    expect(getContainer().textContent).toContain("restored.txt");

    binaryPendingAttachmentExceedsSizeLimitMock.mockReturnValue(true);
    await sendMessage("draft stays");
    await flushAsync();

    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(textarea?.value).toBe("draft stays");
    expect(getContainer().textContent).toContain("restored.txt");
    expect(getAlertMock()).toHaveBeenCalledWith("Message is too large. AI chat can’t send this much content at once. Remove one or more attachments, choose a smaller file or photo, or split the request and try again.");
  });

  it("ignores dropped files while a send is being prepared", async () => {
    const runSyncMock = vi.fn(() => new Promise<void>(() => undefined));
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    await sendMessage("hello");
    await flushAsync();

    const composerState = queryChatComposerState(getContainer());
    const attachButton = queryChatAttachButton(getContainer());
    expect(composerState?.getAttribute("data-send-phase")).toBe("preparingSend");
    expect(attachButton).not.toBeNull();
    expect(attachButton?.disabled).toBe(true);

    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(new File(["pending"], "pending.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).not.toHaveBeenCalled();
  });

  it("ignores delayed attachment processing after the composer becomes locked", async () => {
    let resolveDelayedAttachment: (() => void) | null = null;
    const runSyncMock = vi.fn(() => new Promise<void>(() => undefined));
    useAppDataMock.mockReturnValue(createVerifiedWorkspaceAppDataMock({
      refreshLocalData: vi.fn(async (): Promise<void> => undefined),
      runSync: runSyncMock,
      setErrorMessage: vi.fn(),
    }));
    prepareAttachmentMock.mockImplementation(() => new Promise((resolve) => {
      resolveDelayedAttachment = () => resolve({
        type: "binary",
        fileName: "delayed.txt",
        mediaType: "text/plain",
        base64Data: "ZGVsYXllZA==",
      });
    }));

    await renderChatPanel();
    await flushAsync();
    await flushAsync();

    const sessionId = createNewChatSessionMock.mock.calls[0]?.[0];
    expect(typeof sessionId).toBe("string");

    await dispatchChatPanelDragEvent(getContainer(), createDropEvent(new File(["delayed"], "delayed.txt", { type: "text/plain" })));
    await flushAsync();

    expect(prepareAttachmentMock).toHaveBeenCalledTimes(1);

    await sendMessage("hello");
    await flushAsync();

    const composerState = queryChatComposerState(getContainer());
    expect(composerState?.getAttribute("data-send-phase")).toBe("preparingSend");
    expect(resolveDelayedAttachment).not.toBeNull();

    await act(async () => {
      resolveDelayedAttachment?.();
      await Promise.resolve();
    });
    await flushAsync();

    expect(getContainer().textContent).not.toContain("delayed.txt");
    expect(readStoredDraftPendingAttachmentCount("workspace-1", sessionId as string)).toBe(0);
  });
});
