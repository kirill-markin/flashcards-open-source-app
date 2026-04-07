// @vitest-environment jsdom
import { act, createElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../types";

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

vi.mock("./ChatSessionControllerContext", () => ({
  useOptionalChatSession: useOptionalChatSessionMock,
}));

import { useAiCardHandoff } from "./useAiCardHandoff";

type TestHarnessProps = Readonly<{
  card: Card;
}>;

function TestHarness(props: TestHarnessProps) {
  const { card } = props;
  const handoff = useAiCardHandoff();

  return createElement("button", {
    type: "button",
    onClick: () => {
      void handoff(card);
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
      replaceDraftForSession,
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
      root?.render(createElement(TestHarness, { card: createCard() }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

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
      replaceDraftForSession,
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
      root?.render(createElement(TestHarness, { card: createCard({ cardId: "card-2" }) }));
    });

    const button = container?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected handoff button");
    }

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

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
});
