import { expect, type Locator, type Page, type Request } from "@playwright/test";

import type { LiveSmokeDiagnostics } from "../../live-smoke.diagnostics";
import { classifyAiTransportGetRequest } from "../aiTransport";
import { externalUiTimeoutMs } from "../config";
import type {
  AiCreateAttemptResolution,
  AiRunAcceptanceState,
  AiTransportObservation,
  AiTransportObserver,
  CompletedSqlToolCall,
} from "../types";

export function createAiTransportObserver(page: Page): AiTransportObserver {
  let isObserving = false;
  let liveAttachRequestCount = 0;
  let snapshotPollRequestCount = 0;
  let sessionlessChatSnapshotRequestCount = 0;
  let sessionlessChatRunRequestCount = 0;
  let sessionlessTranscriptionRequestCount = 0;

  function buildObservation(): AiTransportObservation {
    return {
      liveAttachRequestCount,
      snapshotPollRequestCount,
      sessionlessChatSnapshotRequestCount,
      sessionlessChatRunRequestCount,
      sessionlessTranscriptionRequestCount,
    };
  }

  const handleRequest = (request: Request): void => {
    if (isObserving === false) {
      return;
    }

    const url = request.url();
    const getRequestKind = classifyAiTransportGetRequest({
      method: request.method(),
      url,
      resourceType: request.resourceType(),
      headers: request.headers(),
    });

    if (getRequestKind === "sessionless_chat_snapshot") {
      sessionlessChatSnapshotRequestCount += 1;
      return;
    }

    if (getRequestKind === "snapshot_poll") {
      snapshotPollRequestCount += 1;
      return;
    }

    if (getRequestKind === "live_attach") {
      liveAttachRequestCount += 1;
      return;
    }

    if (request.method() === "GET" && url.includes("/v1/chat")) {
      if (url.includes("sessionId=") === false) {
        sessionlessChatSnapshotRequestCount += 1;
        return;
      }
    }

    if (request.method() === "POST" && url.endsWith("/v1/chat")) {
      const requestBody = request.postDataJSON() as { sessionId?: unknown } | null;
      if (typeof requestBody?.sessionId !== "string" || requestBody.sessionId.trim() === "") {
        sessionlessChatRunRequestCount += 1;
      }
      return;
    }

    if (request.method() === "POST" && url.endsWith("/v1/chat/transcriptions")) {
      const requestBody = request.postData() ?? "";
      if (requestBody.includes('name="sessionId"') === false) {
        sessionlessTranscriptionRequestCount += 1;
      }
    }
  };

  page.on("request", handleRequest);

  return {
    start: (): void => {
      liveAttachRequestCount = 0;
      snapshotPollRequestCount = 0;
      sessionlessChatSnapshotRequestCount = 0;
      sessionlessChatRunRequestCount = 0;
      sessionlessTranscriptionRequestCount = 0;
      isObserving = true;
    },
    read: (): AiTransportObservation => buildObservation(),
    stop: (): AiTransportObservation => {
      isObserving = false;
      return buildObservation();
    },
    dispose: (): void => {
      isObserving = false;
      page.off("request", handleRequest);
    },
  };
}

export async function waitForAiChatSendReadiness(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await diagnostics.runAction("wait for AI chat sync gate to clear before send", async () => {
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        return await syncStatus.first().isVisible().catch(() => false) ? "syncing" : "ready";
      },
      { timeout: externalUiTimeoutMs },
    ).toBe("ready");
  });

  await diagnostics.runAction("wait for AI chat local outbox to clear before send", async () => {
    await expect.poll(
      async () => page.evaluate(async () => {
        return new Promise<number>((resolve, reject) => {
          const openRequest = window.indexedDB.open("flashcards-web-sync");
          openRequest.onerror = () => {
            reject(new Error("IndexedDB open failed while checking AI chat outbox readiness"));
          };
          openRequest.onsuccess = () => {
            const database = openRequest.result;
            const transaction = database.transaction(["outbox"], "readonly");
            const request = transaction.objectStore("outbox").getAll();
            request.onerror = () => {
              database.close();
              reject(new Error("IndexedDB outbox read failed while checking AI chat outbox readiness"));
            };
            request.onsuccess = () => {
              const rows = Array.isArray(request.result) ? request.result : [];
              database.close();
              resolve(rows.length);
            };
          };
        });
      }),
      { timeout: externalUiTimeoutMs },
    ).toBe(0);
  });
}

export async function waitForAiRunAccepted(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  attemptNumber: number,
  previousUserMessageCount: number,
  previousAssistantErrorCount: number,
): Promise<AiRunAcceptanceState> {
  return diagnostics.runAction(
    `confirm AI create prompt attempt ${String(attemptNumber)} was accepted by the chat composer`,
    async (): Promise<AiRunAcceptanceState> => {
      const timeoutAt = Date.now() + externalUiTimeoutMs;
      let runAcceptanceState: "waiting" | "running" | "queued" | "error" = "waiting";

      while (Date.now() < timeoutAt) {
        const assistantErrorCount = await page.locator(".chat-msg-error").count();
        if (assistantErrorCount > previousAssistantErrorCount) {
          runAcceptanceState = "error";
          break;
        }

        const stopButtonVisible = await page.getByTestId("chat-stop-button").isVisible().catch(() => false);
        if (stopButtonVisible) {
          runAcceptanceState = "running";
          break;
        }

        const currentUserMessageCount = await page.locator(".chat-msg.chat-msg-user").count();
        if (currentUserMessageCount > previousUserMessageCount) {
          runAcceptanceState = "queued";
          break;
        }

        await page.waitForTimeout(250);
      }

      if (runAcceptanceState === "waiting") {
        throw new Error(`AI create prompt attempt ${String(attemptNumber)} was not accepted before timeout.`);
      }

      if (runAcceptanceState === "error") {
        throw new Error(`AI create prompt attempt ${String(attemptNumber)} reported an assistant error before the run was accepted.`);
      }

      return runAcceptanceState;
    },
  );
}

export async function waitForAiRunCompletion(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  attemptNumber: number,
  previousAssistantErrorCount: number,
): Promise<AiCreateAttemptResolution> {
  return diagnostics.runAction(
    `wait for AI create prompt attempt ${String(attemptNumber)} run to finish and return send action`,
    async (): Promise<AiCreateAttemptResolution> => {
      const timeoutAt = Date.now() + externalUiTimeoutMs;
      let runCompletionState: "running" | "idle" | "inserted" | "error" = "running";
      let matchedInsertToolCall: CompletedSqlToolCall | null = await findCompletedCardInsertToolCall(page);

      while (Date.now() < timeoutAt) {
        const assistantErrorCount = await page.locator(".chat-msg-error").count();
        if (assistantErrorCount > previousAssistantErrorCount) {
          runCompletionState = "error";
          break;
        }

        if (matchedInsertToolCall !== null) {
          runCompletionState = "inserted";
          break;
        }

        const sendVisible = await page.getByTestId("chat-send-button").isVisible().catch(() => false);
        if (sendVisible) {
          runCompletionState = "idle";
          break;
        }

        matchedInsertToolCall = await findCompletedCardInsertToolCall(page);
        await page.waitForTimeout(250);
      }

      if (runCompletionState === "running") {
        throw new Error(`AI create prompt attempt ${String(attemptNumber)} did not finish before timeout.`);
      }

      if (runCompletionState === "error") {
        throw new Error(`AI create prompt attempt ${String(attemptNumber)} reported an assistant error before the run completed.`);
      }

      return {
        completionState: runCompletionState,
        matchedInsertToolCall,
      };
    },
  );
}

export async function waitForCompletedCardInsertToolCall(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  timeoutMs: number,
): Promise<CompletedSqlToolCall | null> {
  return diagnostics.runAction(actionName, async () => {
    const timeoutAt = Date.now() + timeoutMs;
    let matchedToolCall: CompletedSqlToolCall | null = await findCompletedCardInsertToolCall(page);

    while (matchedToolCall === null && Date.now() < timeoutAt) {
      await page.waitForTimeout(250);
      matchedToolCall = await findCompletedCardInsertToolCall(page);
    }

    return matchedToolCall;
  });
}

export async function findCompletedCardInsertToolCall(
  page: Page,
): Promise<CompletedSqlToolCall | null> {
  const completedSqlToolCalls = await readCompletedSqlToolCalls(page);
  for (const toolCall of completedSqlToolCalls) {
    if (toolCall.summary.includes("INSERT INTO cards") === false) {
      continue;
    }

    if (toolCall.request !== null && toolCall.request.includes("INSERT INTO cards") === false) {
      continue;
    }

    if (toolCall.response !== null && toolCall.response.includes("\"ok\":true") === false) {
      continue;
    }

    return toolCall;
  }

  return null;
}

export async function readCompletedSqlToolCalls(page: Page): Promise<ReadonlyArray<CompletedSqlToolCall>> {
  return page.locator(".chat-sidebar-fullscreen").evaluate((chatRoot) => {
    function readSectionText(
      toolCallElement: Element,
      expectedTitle: string,
    ): string | null {
      const sections = toolCallElement.querySelectorAll(".chat-tool-call-section");
      for (const section of sections) {
        const titleElement = section.querySelector(".chat-tool-call-section-title");
        if (titleElement?.textContent?.trim() !== expectedTitle) {
          continue;
        }

        const contentElement = section.querySelector(".chat-tool-call-input, .chat-tool-call-output");
        const contentText = contentElement?.textContent;
        if (contentText === undefined || contentText === null) {
          return null;
        }

        return contentText.trim();
      }

      return null;
    }

    const toolCallElements = Array.from(chatRoot.querySelectorAll(".chat-tool-call.chat-tool-call-completed"));
    return toolCallElements
      .map((toolCallElement) => {
        const summary = toolCallElement.querySelector(".chat-tool-call-summary-main")?.textContent?.trim() ?? "";
        const status = toolCallElement.querySelector(".chat-tool-call-status")?.textContent?.trim() ?? "";
        return {
          summary,
          status,
          request: readSectionText(toolCallElement, "Request"),
          response: readSectionText(toolCallElement, "Response"),
        };
      })
      .filter((toolCall) => toolCall.status === "Done" && toolCall.summary.startsWith("SQL"))
      .map((toolCall) => ({
        summary: toolCall.summary,
        request: toolCall.request,
        response: toolCall.response,
      }));
  });
}

export async function readComposerSuggestionTexts(
  chatRoot: Locator,
): Promise<ReadonlyArray<string>> {
  return chatRoot.locator(".chat-composer-suggestion").evaluateAll((elements) =>
    elements
      .map((element) => element.textContent?.trim() ?? "")
      .filter((text) => text.length > 0));
}
