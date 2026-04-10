import { expect, type Locator } from "@playwright/test";

import {
  trackedClick,
  trackedFill,
  trackedWaitForComposerReady,
  trackedWaitForComposerState,
  trackedWaitForUrl,
} from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import {
  createAiTransportObserver,
  readCompletedSqlToolCalls,
  waitForAiChatSendReadiness,
  waitForAiRunAccepted,
  waitForAiRunCompletion,
  waitForCompletedCardInsertToolCall,
} from "../observations/ai";
import { runLiveSmokeStep } from "../steps";
import type {
  AiRunAcceptanceState,
  AiTransportObservation,
  LiveSmokeSession,
} from "../types";

type AiCreateComposerLifecycleState = "idle_empty" | "transitional_running" | "unknown";

type AiCreateComposerContractSource = "explicit" | "legacy";

type AiCreateComposerSnapshot = Readonly<{
  source: AiCreateComposerContractSource;
  state: string | null;
  action: string | null;
  actionButtonState: string | null;
  canSend: string | null;
  draftState: string | null;
  sendPhase: string | null;
  sendButtonState: string | null;
  runState: string | null;
  inputText: string;
  isSendEnabled: boolean;
  isStopVisible: boolean;
}>;

type AiCreatePostInsertComposerObservation = Readonly<{
  source: AiCreateComposerContractSource;
  state: AiCreateComposerLifecycleState;
}>;

export async function runAiCardCreationFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "create one AI card with explicit confirmation and confirm the insert completed", async () => {
    await runAiCardCreationWithConfirmation(session);
  });
}

export async function runAiConversationResetFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "start a new chat and confirm the conversation resets cleanly", async () => {
    await assertNewChatResetsConversation(session);
  });
}

async function runAiCardCreationWithConfirmation(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  await trackedClick(diagnostics, "open AI chat navigation", page.locator('nav.nav a[href="/chat"]').first());
  await trackedWaitForUrl(
    page,
    diagnostics,
    "wait for AI chat route to become active",
    /\/chat$/,
    externalUiTimeoutMs,
  );
  const fullscreenChat = page.getByTestId("chat-panel");
  const messageField = page.getByTestId("chat-composer-input");
  const sendButton = page.getByTestId("chat-send-button");
  const stopButton = page.getByTestId("chat-stop-button");
  const createPrompt = "I give you all permissions. Please create one test flashcard now.";
  const bootstrapTransportObserver = createAiTransportObserver(page);
  const transportObserver = createAiTransportObserver(page);

  bootstrapTransportObserver.start();
  await diagnostics.runAction("confirm fullscreen AI chat surface is visible", async () => {
    await expect(fullscreenChat).toBeVisible({ timeout: externalUiTimeoutMs });
  });
  await waitForAiChatSendReadiness(page, diagnostics);
  await trackedWaitForComposerState(
    diagnostics,
    "confirm AI create flow starts with an empty draft and disabled send action",
    messageField,
    sendButton,
    "",
    false,
    externalUiTimeoutMs,
  );
  const bootstrapTransportObservation = bootstrapTransportObserver.stop();
  await diagnostics.runAction(
    "confirm AI chat bootstrap did not use session-less /chat or /chat/transcriptions requests",
    async () => {
      expect(bootstrapTransportObservation.sessionlessChatSnapshotRequestCount).toBe(0);
      expect(bootstrapTransportObservation.sessionlessChatRunRequestCount).toBe(0);
      expect(bootstrapTransportObservation.sessionlessTranscriptionRequestCount).toBe(0);
    },
  );

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const previousUserMessageCount = await diagnostics.runAction(
        `read user message count before AI create prompt attempt ${String(attempt)}`,
        async () => page.locator(".chat-msg.chat-msg-user").count(),
      );
      const previousAssistantErrorCount = await diagnostics.runAction(
        `read assistant error count before AI create prompt attempt ${String(attempt)}`,
        async () => page.locator(".chat-msg-error").count(),
      );

      await trackedFill(
        diagnostics,
        `fill AI create prompt attempt ${String(attempt)}`,
        messageField,
        createPrompt,
      );
      await trackedWaitForComposerReady(
        diagnostics,
        `confirm AI create prompt attempt ${String(attempt)} keeps the draft and enables send action`,
        messageField,
        sendButton,
        createPrompt,
        externalUiTimeoutMs,
      );
      transportObserver.start();
      let transportObservation: AiTransportObservation | null = null;
      let acceptanceState: AiRunAcceptanceState | null = null;
      let requiresLiveAttachRequest = false;
      const createAttemptActionLabel = `AI create prompt attempt ${String(attempt)}`;

      try {
        await trackedClick(diagnostics, `send AI create prompt attempt ${String(attempt)}`, sendButton);
        acceptanceState = await waitForAiRunAccepted(
          page,
          diagnostics,
          createAttemptActionLabel,
          previousUserMessageCount,
          previousAssistantErrorCount,
        );

        const attemptResolution = await waitForAiRunCompletion(
          page,
          diagnostics,
          createAttemptActionLabel,
          previousAssistantErrorCount,
        );

        if (attemptResolution.completionState === "inserted") {
          const postInsertComposerObservation = await waitForAiCreatePostInsertComposerState(
            diagnostics,
            `confirm AI create prompt attempt ${String(attempt)} reaches a valid post-insert composer state`,
            fullscreenChat,
            messageField,
            sendButton,
            stopButton,
            localUiTimeoutMs,
          );

          if (postInsertComposerObservation.state === "transitional_running") {
            requiresLiveAttachRequest = true;
            await diagnostics.runAction(
              `wait for AI create prompt attempt ${String(attempt)} live attach request after confirmed insert`,
              async () => {
                await expect.poll(
                  () => transportObserver.read().liveAttachRequestCount,
                  { timeout: localUiTimeoutMs },
                ).toBeGreaterThan(0);
              },
            );
          }
        }

        await waitForAiCreateIdleComposerState(
          diagnostics,
          `confirm AI create prompt attempt ${String(attempt)} returns to empty draft with disabled send action`,
          fullscreenChat,
          messageField,
          sendButton,
          stopButton,
          externalUiTimeoutMs,
        );

        const matchedInsertToolCall = attemptResolution.matchedInsertToolCall ?? await waitForCompletedCardInsertToolCall(
          page,
          diagnostics,
          `wait for completed SQL card insert tool call after AI create attempt ${String(attempt)}`,
          localUiTimeoutMs,
        );

        transportObservation = transportObserver.stop();
        if (acceptanceState === "running") {
          requiresLiveAttachRequest = true;
        }

        await diagnostics.runAction(
          `confirm AI create prompt attempt ${String(attempt)} used valid live transport without snapshot polling or session-less chat requests`,
          async () => {
            expect(transportObservation.snapshotPollRequestCount).toBe(0);
            expect(transportObservation.sessionlessChatSnapshotRequestCount).toBe(0);
            expect(transportObservation.sessionlessChatRunRequestCount).toBe(0);
            expect(transportObservation.sessionlessTranscriptionRequestCount).toBe(0);
            if (requiresLiveAttachRequest) {
              expect(transportObservation.liveAttachRequestCount).toBeGreaterThan(0);
            }
          },
        );

        if (matchedInsertToolCall !== null) {
          return;
        }
      } finally {
        if (transportObservation === null) {
          transportObserver.stop();
        }
      }
    }
  } finally {
    bootstrapTransportObserver.dispose();
    transportObserver.dispose();
  }

  const completedSqlToolCalls = await diagnostics.runAction(
    "collect completed SQL tool calls after exhausted AI create attempts",
    async () => readCompletedSqlToolCalls(page),
  );
  const sqlSummary = completedSqlToolCalls.length === 0
    ? "none"
    : completedSqlToolCalls.map((toolCall, index) => {
      const requestPreview = toolCall.request === null ? "request=<missing>" : `request=${toolCall.request}`;
      const responsePreview = toolCall.response === null ? "response=<missing>" : `response=${toolCall.response}`;
      return `[${String(index + 1)}] summary=${toolCall.summary} ${requestPreview} ${responsePreview}`;
    }).join("\n");

  throw new Error(
    "AI chat did not create the expected card after 3 attempts. "
    + "No completed SQL INSERT INTO cards tool call passed the smoke check. "
    + `Completed SQL tool calls:\n${sqlSummary}`,
  );
}

async function assertNewChatResetsConversation(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  const fullscreenChat = page.getByTestId("chat-panel");
  const messageField = page.getByTestId("chat-composer-input");
  const sendButton = page.getByTestId("chat-send-button");
  const suggestionContainer = fullscreenChat.getByTestId("chat-composer-suggestions");
  const suggestionButtons = fullscreenChat.getByTestId("chat-composer-suggestion");

  await trackedClick(
    diagnostics,
    "start a fresh AI chat from the top bar",
    page.getByTestId("chat-new-button"),
  );
  await diagnostics.runAction("confirm AI chat empty state is visible after starting a new chat", async () => {
    await expect(page.getByTestId("chat-empty-title")).toBeVisible({ timeout: externalUiTimeoutMs });
  });
  await diagnostics.runAction("confirm AI chat has no remaining messages or message-level errors", async () => {
    const allMessages = page.locator(".chat-msg");
    const errorMessages = page.locator(".chat-msg-error");
    await expect.poll(async () => allMessages.count(), { timeout: externalUiTimeoutMs }).toBe(0);
    await expect.poll(async () => errorMessages.count(), { timeout: externalUiTimeoutMs }).toBe(0);
  });
  await trackedWaitForComposerState(
    diagnostics,
    "confirm AI chat reset leaves an empty draft and disabled send action",
    messageField,
    sendButton,
    "",
    false,
    externalUiTimeoutMs,
  );

  await waitForComposerSuggestionsVisible(
    diagnostics,
    suggestionContainer,
    suggestionButtons,
    "confirm AI chat reset shows composer suggestions for an empty draft",
    externalUiTimeoutMs,
  );

  await trackedClick(
    diagnostics,
    "apply the first composer suggestion",
    suggestionButtons.nth(0),
  );
  await waitForSuggestionToFillDraft(
    diagnostics,
    "confirm the first composer suggestion fills the draft and enables send",
    messageField,
    sendButton,
    externalUiTimeoutMs,
  );
  await waitForComposerSuggestionsHidden(
    diagnostics,
    suggestionContainer,
    suggestionButtons,
    "confirm composer suggestions hide while the draft is non-empty",
    externalUiTimeoutMs,
  );

  await trackedFill(
    diagnostics,
    "clear the composer draft after applying the first backend suggestion",
    messageField,
    "",
  );
  await trackedWaitForComposerState(
    diagnostics,
    "confirm clearing the composer draft disables send again",
    messageField,
    sendButton,
    "",
    false,
    externalUiTimeoutMs,
  );

  await waitForComposerSuggestionsVisible(
    diagnostics,
    suggestionContainer,
    suggestionButtons,
    "confirm composer suggestions return when the draft is cleared",
    externalUiTimeoutMs,
  );

  const previousUserMessageCount = await diagnostics.runAction(
    "read user message count before sending the backend suggestion",
    async () => page.locator(".chat-msg.chat-msg-user").count(),
  );
  const previousAssistantErrorCount = await diagnostics.runAction(
    "read assistant error count before sending the backend suggestion",
    async () => page.locator(".chat-msg-error").count(),
  );

  await trackedClick(
    diagnostics,
    "apply a composer suggestion after clearing the draft",
    suggestionButtons.nth(0),
  );
  await waitForSuggestionToFillDraft(
    diagnostics,
    "confirm the composer suggestion fills the draft after clearing the draft",
    messageField,
    sendButton,
    externalUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "send the backend composer suggestion",
    sendButton,
  );
  const resetSuggestionActionLabel = "the backend suggestion run after the chat reset";

  await waitForAiRunAccepted(
    page,
    diagnostics,
    resetSuggestionActionLabel,
    previousUserMessageCount,
    previousAssistantErrorCount,
  );
  await waitForAiRunCompletion(
    page,
    diagnostics,
    resetSuggestionActionLabel,
    previousAssistantErrorCount,
  );

  await trackedWaitForComposerState(
    diagnostics,
    "confirm the completed suggestion run returns to an empty draft with disabled send action",
    messageField,
    sendButton,
    "",
    false,
    externalUiTimeoutMs,
  );

  await waitForComposerSuggestionsVisible(
    diagnostics,
    suggestionContainer,
    suggestionButtons,
    "confirm the completed assistant reply surfaces follow-up composer suggestions",
    externalUiTimeoutMs,
  );

  await trackedClick(
    diagnostics,
    "apply the first follow-up composer suggestion",
    suggestionButtons.nth(0),
  );
  await waitForSuggestionToFillDraft(
    diagnostics,
    "confirm the first follow-up composer suggestion fills the draft",
    messageField,
    sendButton,
    externalUiTimeoutMs,
  );
}

async function waitForComposerSuggestionsVisible(
  diagnostics: LiveSmokeSession["diagnostics"],
  suggestionContainer: Locator,
  suggestionButtons: Locator,
  actionLabel: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionLabel, async () => {
    await expect(suggestionContainer).toBeVisible({ timeout: timeoutMs });
    await expect.poll(async () => {
      const rawCount = await suggestionContainer.getAttribute("data-suggestion-count");

      if (rawCount === null) {
        return 0;
      }

      const parsedCount = Number.parseInt(rawCount, 10);
      return Number.isNaN(parsedCount) ? 0 : parsedCount;
    }, { timeout: timeoutMs }).toBeGreaterThan(0);
    await expect.poll(async () => suggestionButtons.count(), { timeout: timeoutMs }).toBeGreaterThan(0);
  });
}

async function waitForComposerSuggestionsHidden(
  diagnostics: LiveSmokeSession["diagnostics"],
  suggestionContainer: Locator,
  suggestionButtons: Locator,
  actionLabel: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionLabel, async () => {
    await expect(suggestionContainer).toBeHidden({ timeout: timeoutMs });
    await expect.poll(async () => suggestionButtons.count(), { timeout: timeoutMs }).toBe(0);
  });
}

async function waitForSuggestionToFillDraft(
  diagnostics: LiveSmokeSession["diagnostics"],
  actionLabel: string,
  messageField: Locator,
  sendButton: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionLabel, async () => {
    await expect.poll(async () => {
      const draftText = await messageField.inputValue();
      return draftText.trim().length;
    }, { timeout: timeoutMs }).toBeGreaterThan(0);
    await expect(sendButton).toBeEnabled({ timeout: timeoutMs });
  });
}

async function waitForAiCreatePostInsertComposerState(
  diagnostics: LiveSmokeSession["diagnostics"],
  actionLabel: string,
  chatPanel: Locator,
  messageField: Locator,
  sendButton: Locator,
  stopButton: Locator,
  timeoutMs: number,
): Promise<AiCreatePostInsertComposerObservation> {
  return diagnostics.runAction(actionLabel, async () => {
    let lastSnapshot = await readAiCreateComposerSnapshot(chatPanel, messageField, sendButton, stopButton);

    await expect.poll(
      async () => {
        lastSnapshot = await readAiCreateComposerSnapshot(chatPanel, messageField, sendButton, stopButton);
        return classifyAiCreateComposerLifecycleState(lastSnapshot);
      },
      { timeout: timeoutMs },
    ).not.toBe("unknown");

    return {
      source: lastSnapshot.source,
      state: classifyAiCreateComposerLifecycleState(lastSnapshot),
    };
  });
}

async function waitForAiCreateIdleComposerState(
  diagnostics: LiveSmokeSession["diagnostics"],
  actionLabel: string,
  chatPanel: Locator,
  messageField: Locator,
  sendButton: Locator,
  stopButton: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionLabel, async () => {
    await expect.poll(
      async () => classifyAiCreateComposerLifecycleState(
        await readAiCreateComposerSnapshot(chatPanel, messageField, sendButton, stopButton),
      ),
      { timeout: timeoutMs },
    ).toBe("idle_empty");
  });
}

async function readAiCreateComposerSnapshot(
  chatPanel: Locator,
  messageField: Locator,
  sendButton: Locator,
  stopButton: Locator,
): Promise<AiCreateComposerSnapshot> {
  const contractSnapshot = await chatPanel.evaluate((chatPanelElement) => {
    function readAttribute(
      element: Element | null,
      attributeNames: ReadonlyArray<string>,
    ): string | null {
      if (element === null) {
        return null;
      }

      for (const attributeName of attributeNames) {
        const attributeValue = element.getAttribute(attributeName);
        if (attributeValue !== null && attributeValue.trim() !== "") {
          return attributeValue.trim();
        }
      }

      return null;
    }

    const contractElement = chatPanelElement.querySelector('[data-testid="chat-composer-state"]');
    const attributeSource = contractElement ?? chatPanelElement;
    const state = readAttribute(attributeSource, [
      "data-composer-state",
      "data-state",
    ]);
    const action = readAttribute(attributeSource, [
      "data-composer-action",
      "data-action",
    ]);
    const actionButtonState = readAttribute(attributeSource, [
      "data-action-button-state",
      "data-composer-action-state",
    ]);
    const draftState = readAttribute(attributeSource, [
      "data-draft-state",
      "data-draft",
    ]);
    const canSend = readAttribute(attributeSource, [
      "data-can-send",
    ]);
    const sendPhase = readAttribute(attributeSource, [
      "data-send-phase",
      "data-send-state",
    ]);
    const sendButtonState = readAttribute(attributeSource, [
      "data-send-button-state",
      "data-composer-send-button-state",
    ]);
    const runState = readAttribute(attributeSource, [
      "data-chat-run-state",
      "data-run-state",
      "data-run",
    ]);

    return {
      state,
      action,
      actionButtonState,
      canSend,
      draftState,
      sendPhase,
      sendButtonState,
      runState,
      hasExplicitContract: state !== null
        || action !== null
        || actionButtonState !== null
        || canSend !== null
        || draftState !== null
        || sendPhase !== null
        || sendButtonState !== null
        || runState !== null,
    };
  });

  return {
    source: contractSnapshot.hasExplicitContract ? "explicit" : "legacy",
    state: contractSnapshot.state,
    action: contractSnapshot.action,
    actionButtonState: contractSnapshot.actionButtonState,
    canSend: contractSnapshot.canSend,
    draftState: contractSnapshot.draftState,
    sendPhase: contractSnapshot.sendPhase,
    sendButtonState: contractSnapshot.sendButtonState,
    runState: contractSnapshot.runState,
    inputText: await messageField.inputValue(),
    isSendEnabled: await sendButton.isEnabled().catch(() => false),
    isStopVisible: await stopButton.isVisible().catch(() => false),
  };
}

function classifyAiCreateComposerLifecycleState(
  snapshot: AiCreateComposerSnapshot,
): AiCreateComposerLifecycleState {
  const isEmptyDraft = matchesComposerContractValue(snapshot.draftState, "empty", "empty-draft")
    || snapshot.inputText.trim() === "";
  const isIdleByContract = matchesComposerContractValue(snapshot.state, "idle", "idle_empty", "idle-empty")
    || (
      matchesComposerContractValue(snapshot.action, "send")
      && (snapshot.sendPhase === null || matchesComposerContractValue(snapshot.sendPhase, "idle"))
      && (snapshot.sendButtonState === null || matchesComposerContractValue(snapshot.sendButtonState, "idle"))
      && (snapshot.runState === null || matchesComposerContractValue(snapshot.runState, "idle", "interrupted"))
      && isEmptyDraft
      && (snapshot.canSend === null || matchesComposerContractValue(snapshot.canSend, "false"))
      && snapshot.isSendEnabled === false
    );
  const isRunningByContract = matchesComposerContractValue(
    snapshot.state,
    "running",
    "stopping",
    "transitional_running",
    "transitional-running",
  )
    || (
      matchesComposerContractValue(snapshot.action, "stop")
      || matchesComposerContractValue(snapshot.actionButtonState, "stop", "stop-disabled")
      || matchesComposerContractValue(snapshot.runState, "running")
    )
    && isEmptyDraft
    && snapshot.isSendEnabled === false;

  if (isIdleByContract) {
    return "idle_empty";
  }

  if (isRunningByContract) {
    return "transitional_running";
  }

  if (isEmptyDraft && snapshot.isStopVisible) {
    return "transitional_running";
  }

  if (isEmptyDraft && snapshot.isSendEnabled === false && snapshot.isStopVisible === false) {
    return "idle_empty";
  }

  return "unknown";
}

function matchesComposerContractValue(
  value: string | null,
  ...expectedValues: ReadonlyArray<string>
): boolean {
  if (value === null) {
    return false;
  }

  return expectedValues.includes(value);
}
