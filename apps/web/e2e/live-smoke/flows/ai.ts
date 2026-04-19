import { expect, type Page } from "@playwright/test";

import {
  trackedClick,
  trackedFill,
  trackedWaitForComposerReady,
  trackedWaitForComposerState,
  trackedWaitForUrl,
} from "../../live-smoke.actions";
import { aiCompletionTimeoutMs, externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import {
  createAiTransportObserver,
  isAiComposerTerminalIdle,
  isAiRunRunning,
  readCompletedSqlToolCalls,
  readAiComposerContract,
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

type AiCreatePostInsertComposerState = "idle_empty" | "transitional_running";

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
          aiCompletionTimeoutMs,
        );

        if (attemptResolution.completionState === "inserted") {
          const postInsertComposerState = await waitForAiCreatePostInsertComposerState(
            page,
            diagnostics,
            `confirm AI create prompt attempt ${String(attempt)} reaches a valid post-insert composer state`,
            localUiTimeoutMs,
          );

          if (postInsertComposerState === "transitional_running") {
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
          page,
          diagnostics,
          `confirm AI create prompt attempt ${String(attempt)} returns to empty draft with disabled send action`,
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
  const messageField = page.getByTestId("chat-composer-input");
  const sendButton = page.getByTestId("chat-send-button");

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
}

async function waitForAiCreatePostInsertComposerState(
  page: Page,
  diagnostics: LiveSmokeSession["diagnostics"],
  actionLabel: string,
  timeoutMs: number,
): Promise<AiCreatePostInsertComposerState> {
  return diagnostics.runAction(actionLabel, async () => {
    let postInsertComposerState: AiCreatePostInsertComposerState | "unknown" = "unknown";

    await expect.poll(
      async () => {
        const composerContract = await readAiComposerContract(page);
        if (isAiRunRunning(composerContract)) {
          postInsertComposerState = "transitional_running";
          return postInsertComposerState;
        }

        if (isAiComposerTerminalIdle(composerContract)) {
          postInsertComposerState = "idle_empty";
          return postInsertComposerState;
        }

        return "unknown";
      },
      { timeout: timeoutMs },
    ).not.toBe("unknown");

    if (postInsertComposerState === "unknown") {
      throw new Error("AI create prompt did not reach a recognized post-insert composer state.");
    }

    return postInsertComposerState;
  });
}

async function waitForAiCreateIdleComposerState(
  page: Page,
  diagnostics: LiveSmokeSession["diagnostics"],
  actionLabel: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionLabel, async () => {
    await expect.poll(
      async () => isAiComposerTerminalIdle(await readAiComposerContract(page)),
      { timeout: timeoutMs },
    ).toBe(true);
  });
}
