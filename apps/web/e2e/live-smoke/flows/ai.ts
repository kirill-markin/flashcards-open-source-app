import { expect, type Locator } from "@playwright/test";

import {
  trackedClick,
  trackedFill,
  trackedIsVisible,
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

      try {
        await trackedClick(diagnostics, `send AI create prompt attempt ${String(attempt)}`, sendButton);
        acceptanceState = await waitForAiRunAccepted(
          page,
          diagnostics,
          attempt,
          previousUserMessageCount,
          previousAssistantErrorCount,
        );

        const attemptResolution = await waitForAiRunCompletion(
          page,
          diagnostics,
          attempt,
          previousAssistantErrorCount,
        );

        if (attemptResolution.completionState === "inserted") {
          const stopButton = page.getByTestId("chat-stop-button");
          const stopButtonVisible = await trackedIsVisible(
            diagnostics,
            `check whether AI create prompt attempt ${String(attempt)} still shows an active stop action after insert`,
            stopButton,
          );

          if (stopButtonVisible) {
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
            await trackedClick(
              diagnostics,
              `stop AI create prompt attempt ${String(attempt)} after confirmed insert`,
              stopButton,
            );
          }
        }

        await trackedWaitForComposerState(
          diagnostics,
          `confirm AI create prompt attempt ${String(attempt)} returns to empty draft with disabled send action`,
          messageField,
          sendButton,
          "",
          false,
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

  await diagnostics.runAction(
    "confirm the assistant run accepts the backend composer suggestion",
    async () => {
      const timeoutAt = Date.now() + externalUiTimeoutMs;

      while (Date.now() < timeoutAt) {
        const assistantErrorCount = await page.locator(".chat-msg-error").count();
        if (assistantErrorCount > previousAssistantErrorCount) {
          throw new Error("The assistant reported an error before the suggestion run was accepted.");
        }

        const stopVisible = await page.getByTestId("chat-stop-button").isVisible().catch(() => false);
        if (stopVisible) {
          return;
        }

        const currentUserMessageCount = await page.locator(".chat-msg.chat-msg-user").count();
        if (currentUserMessageCount > previousUserMessageCount) {
          return;
        }

        await page.waitForTimeout(250);
      }

      throw new Error("The assistant run did not accept the suggestion message before timeout.");
    },
  );

  await diagnostics.runAction(
    "confirm the assistant run finishes and returns the composer to idle after the backend suggestion",
    async () => {
      const timeoutAt = Date.now() + externalUiTimeoutMs;

      while (Date.now() < timeoutAt) {
        const assistantErrorCount = await page.locator(".chat-msg-error").count();
        if (assistantErrorCount > previousAssistantErrorCount) {
          throw new Error("The assistant reported an error before the suggestion run completed.");
        }

        const sendVisible = await sendButton.isVisible().catch(() => false);
        if (sendVisible) {
          return;
        }

        await page.waitForTimeout(250);
      }

      throw new Error("The assistant run did not complete before timeout.");
    },
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
