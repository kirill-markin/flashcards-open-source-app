// @vitest-environment jsdom
import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../types";
import type { ChatComposerSendPhase } from "./ChatDraftContext";
import type { PendingAttachment } from "./FileAttachment";

const {
  setErrorMessageMock,
  useOptionalChatLayoutMock,
  useOptionalChatDraftMock,
  useOptionalChatSessionMock,
} = vi.hoisted(() => ({
  setErrorMessageMock: vi.fn(),
  useOptionalChatLayoutMock: vi.fn(),
  useOptionalChatDraftMock: vi.fn(),
  useOptionalChatSessionMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: () => ({
    setErrorMessage: setErrorMessageMock,
  }),
}));

vi.mock("./ChatDraftContext", () => ({
  useOptionalChatDraft: useOptionalChatDraftMock,
}));

vi.mock("./ChatLayoutContext", () => ({
  useOptionalChatLayout: useOptionalChatLayoutMock,
}));

vi.mock("./sessionController", () => ({
  useOptionalChatSession: useOptionalChatSessionMock,
}));

import { useAiCardHandoff } from "./useAiCardHandoff";

const lockedComposerSendPhases: ReadonlyArray<ChatComposerSendPhase> = ["preparingSend", "startingRun"];

type TestHarnessProps = Readonly<{
  card: Card;
  onResult: (result: boolean) => void;
}>;

function TestHarness(props: TestHarnessProps) {
  const { card, onResult } = props;
  const handoff = useAiCardHandoff();

  return createElement("button", {
    type: "button",
    onClick: () => {
      void handoff(card).then((result) => {
        onResult(result);
      });
    },
  }, "Handoff");
}

function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    tags: ["grammar"],
    effortLevel: "medium",
    dueAt: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T00:00:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("useAiCardHandoff", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    setErrorMessageMock.mockReset();
    useOptionalChatLayoutMock.mockReset();
    useOptionalChatDraftMock.mockReset();
    useOptionalChatSessionMock.mockReset();
  });

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }

    container?.remove();
    root = null;
    container = null;
  });

  it("switches dirty handoff into a fresh session and preserves source ownership", async () => {
    const replaceDraftForSession = vi.fn();
    const requestComposerFocus = vi.fn();
    const clearConversation = vi.fn(async (): Promise<string> => "session-2");
    const setIsOpen = vi.fn();
    const onResult = vi.fn();

    useOptionalChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen,
    });
    useOptionalChatDraftMock.mockReturnValue({
      draft: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        inputText: "keep existing draft",
        pendingAttachments: [],
      },
      composerSendPhase: "idle",
      replaceDraftForSession,
      replaceComposerSendPhase: vi.fn(),
      requestComposerFocus,
    });
    useOptionalChatSessionMock.mockReturnValue({
      currentSessionId: "session-1",
      messages: [{
        role: "user",
        content: [],
      }],
      isAssistantRunActive: false,
      isStopping: false,
      clearConversation,
    });

    await act(async () => {
      root?.render(createElement(TestHarness, { card: createCard(), onResult }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledWith(true);
    expect(clearConversation).toHaveBeenCalledTimes(1);
    expect(replaceDraftForSession).toHaveBeenCalledTimes(1);
    expect(replaceDraftForSession).toHaveBeenCalledWith("session-2", {
      inputText: "",
      pendingAttachments: [expect.objectContaining({
        type: "card",
        cardId: "card-1",
        frontText: "Question",
        backText: "Answer",
        tags: ["grammar"],
        effortLevel: "medium",
      })],
    });
    expect(requestComposerFocus).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it("reuses the current empty idle session without clearing another draft", async () => {
    const replaceDraftForSession = vi.fn();
    const requestComposerFocus = vi.fn();
    const clearConversation = vi.fn();
    const setIsOpen = vi.fn();
    const onResult = vi.fn();

    useOptionalChatLayoutMock.mockReturnValue({
      isOpen: true,
      setIsOpen,
    });
    useOptionalChatDraftMock.mockReturnValue({
      draft: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        inputText: "",
        pendingAttachments: [],
      },
      composerSendPhase: "idle",
      replaceDraftForSession,
      replaceComposerSendPhase: vi.fn(),
      requestComposerFocus,
    });
    useOptionalChatSessionMock.mockReturnValue({
      currentSessionId: "session-1",
      messages: [],
      isAssistantRunActive: false,
      isStopping: false,
      clearConversation,
    });

    await act(async () => {
      root?.render(createElement(TestHarness, { card: createCard({ cardId: "card-2" }), onResult }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledWith(true);
    expect(clearConversation).not.toHaveBeenCalled();
    expect(replaceDraftForSession).toHaveBeenCalledTimes(1);
    expect(replaceDraftForSession).toHaveBeenCalledWith("session-1", {
      inputText: "",
      pendingAttachments: [expect.objectContaining({
        type: "card",
        cardId: "card-2",
      })],
    });
    expect(requestComposerFocus).toHaveBeenCalledTimes(1);
    expect(setIsOpen).not.toHaveBeenCalled();
  });

  it.each(lockedComposerSendPhases)(
    "rejects handoff while composer send phase is %s without side effects",
    async (composerSendPhase) => {
      const replaceDraftForSession = vi.fn();
      const requestComposerFocus = vi.fn();
      const clearConversation = vi.fn(async (): Promise<string> => "session-2");
      const setIsOpen = vi.fn();
      const onResult = vi.fn();

      useOptionalChatLayoutMock.mockReturnValue({
        isOpen: false,
        setIsOpen,
      });
      useOptionalChatDraftMock.mockReturnValue({
        draft: {
          workspaceId: "workspace-1",
          sessionId: "session-1",
          inputText: "send in flight",
          pendingAttachments: [],
        },
        composerSendPhase,
        replaceDraftForSession,
        replaceComposerSendPhase: vi.fn(),
        requestComposerFocus,
      });
      useOptionalChatSessionMock.mockReturnValue({
        currentSessionId: "session-1",
        messages: [],
        isAssistantRunActive: false,
        isStopping: false,
        clearConversation,
      });

      await act(async () => {
        root?.render(createElement(TestHarness, { card: createCard({ cardId: `card-${composerSendPhase}` }), onResult }));
      });

      const button = container?.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Expected handoff button");
      }

      await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onResult).toHaveBeenCalledWith(false);
      expect(clearConversation).not.toHaveBeenCalled();
      expect(replaceDraftForSession).not.toHaveBeenCalled();
      expect(requestComposerFocus).not.toHaveBeenCalled();
      expect(setIsOpen).not.toHaveBeenCalled();
      expect(setErrorMessageMock).not.toHaveBeenCalled();
    },
  );

  it("prepares the current draft while an assistant run is active without clearing the stream", async () => {
    const replaceDraftForSession = vi.fn();
    const requestComposerFocus = vi.fn();
    const clearConversation = vi.fn(async (): Promise<string> => "session-2");
    const setIsOpen = vi.fn();
    const onResult = vi.fn();
    const existingAttachment: PendingAttachment = {
      type: "binary",
      fileName: "existing.txt",
      mediaType: "text/plain",
      base64Data: "ZXhpc3Rpbmc=",
    };

    useOptionalChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen,
    });
    useOptionalChatDraftMock.mockReturnValue({
      draft: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        inputText: "next question",
        pendingAttachments: [existingAttachment],
      },
      composerSendPhase: "idle",
      replaceDraftForSession,
      replaceComposerSendPhase: vi.fn(),
      requestComposerFocus,
    });
    useOptionalChatSessionMock.mockReturnValue({
      currentSessionId: "session-1",
      messages: [{
        role: "user",
        content: [],
      }, {
        role: "assistant",
        content: [],
      }],
      isAssistantRunActive: true,
      isStopping: false,
      clearConversation,
    });

    await act(async () => {
      root?.render(createElement(TestHarness, { card: createCard({ cardId: "card-running" }), onResult }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledWith(true);
    expect(clearConversation).not.toHaveBeenCalled();
    expect(replaceDraftForSession).toHaveBeenCalledTimes(1);
    expect(replaceDraftForSession).toHaveBeenCalledWith("session-1", {
      inputText: "next question",
      pendingAttachments: [
        existingAttachment,
        expect.objectContaining({
          type: "card",
          cardId: "card-running",
          frontText: "Question",
          backText: "Answer",
          tags: ["grammar"],
          effortLevel: "medium",
        }),
      ],
    });
    expect(requestComposerFocus).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledTimes(1);
    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it("rejects handoff while stopping without clearing or consuming the request", async () => {
    const replaceDraftForSession = vi.fn();
    const requestComposerFocus = vi.fn();
    const clearConversation = vi.fn(async (): Promise<string> => "session-2");
    const setIsOpen = vi.fn();
    const onResult = vi.fn();

    useOptionalChatLayoutMock.mockReturnValue({
      isOpen: false,
      setIsOpen,
    });
    useOptionalChatDraftMock.mockReturnValue({
      draft: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        inputText: "keep next draft",
        pendingAttachments: [],
      },
      composerSendPhase: "idle",
      replaceDraftForSession,
      replaceComposerSendPhase: vi.fn(),
      requestComposerFocus,
    });
    useOptionalChatSessionMock.mockReturnValue({
      currentSessionId: "session-1",
      messages: [{
        role: "assistant",
        content: [],
      }],
      isAssistantRunActive: true,
      isStopping: true,
      clearConversation,
    });

    await act(async () => {
      root?.render(createElement(TestHarness, { card: createCard({ cardId: "card-stopping" }), onResult }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResult).toHaveBeenCalledWith(false);
    expect(clearConversation).not.toHaveBeenCalled();
    expect(replaceDraftForSession).not.toHaveBeenCalled();
    expect(requestComposerFocus).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalled();
    expect(setErrorMessageMock).not.toHaveBeenCalled();
  });
});
