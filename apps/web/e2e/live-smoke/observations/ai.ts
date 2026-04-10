import { expect, type Locator, type Page, type Request } from "@playwright/test";

import type { LiveSmokeDiagnostics } from "../../live-smoke.diagnostics";
import { classifyAiTransportGetRequest } from "../../support/aiTransport";
import { externalUiTimeoutMs } from "../config";
import type {
  AiCreateAttemptResolution,
  AiRunAcceptanceState,
  AiTransportObservation,
  AiTransportObserver,
  CompletedSqlToolCall,
} from "../types";

type AiComposerState = "idle" | "preparingSend" | "startingRun" | "running" | "stopping";
type AiComposerAction = "send" | "stop";
type AiChatRunState = "idle" | "running" | "interrupted";
type AiSendPhase = "idle" | "preparingSend" | "startingRun";
type AiDraftState = "empty" | "filled";
type AiCanSend = "true" | "false";

type AiComposerContract = Readonly<{
  composerState: AiComposerState;
  composerAction: AiComposerAction;
  chatRunState: AiChatRunState;
  sendPhase: AiSendPhase;
  draftState: AiDraftState;
  canSend: AiCanSend;
}>;

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
  actionLabel: string,
  previousUserMessageCount: number,
  previousAssistantErrorCount: number,
): Promise<AiRunAcceptanceState> {
  return diagnostics.runAction(
    `confirm ${actionLabel} was accepted by the chat composer`,
    async (): Promise<AiRunAcceptanceState> => {
      const timeoutAt = Date.now() + externalUiTimeoutMs;
      let runAcceptanceState: "waiting" | "running" | "queued" | "error" = "waiting";

      while (Date.now() < timeoutAt) {
        const assistantErrorCount = await page.locator(".chat-msg-error").count();
        if (assistantErrorCount > previousAssistantErrorCount) {
          runAcceptanceState = "error";
          break;
        }

        const composerContract = await readAiComposerContract(page);
        if (isAiRunRunning(composerContract)) {
          runAcceptanceState = "running";
          break;
        }

        const currentUserMessageCount = await page.locator(".chat-msg.chat-msg-user").count();
        if (isAiRunQueued(composerContract)) {
          runAcceptanceState = "queued";
          break;
        }

        if (currentUserMessageCount > previousUserMessageCount && isAiComposerTerminalIdle(composerContract)) {
          runAcceptanceState = "queued";
          break;
        }

        await page.waitForTimeout(250);
      }

      if (runAcceptanceState === "waiting") {
        throw new Error(`${actionLabel} was not accepted before timeout.`);
      }

      if (runAcceptanceState === "error") {
        throw new Error(`${actionLabel} reported an assistant error before the run was accepted.`);
      }

      return runAcceptanceState;
    },
  );
}

export async function waitForAiRunCompletion(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionLabel: string,
  previousAssistantErrorCount: number,
  timeoutMs: number,
): Promise<AiCreateAttemptResolution> {
  return diagnostics.runAction(
    `wait for ${actionLabel} to finish and return the composer to idle`,
    async (): Promise<AiCreateAttemptResolution> => {
      const timeoutAt = Date.now() + timeoutMs;
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

        const composerContract = await readAiComposerContract(page);
        if (isAiComposerTerminalIdle(composerContract)) {
          runCompletionState = "idle";
          break;
        }

        matchedInsertToolCall = await findCompletedCardInsertToolCall(page);
        await page.waitForTimeout(250);
      }

      if (runCompletionState === "running") {
        throw new Error(`${actionLabel} did not finish before timeout.`);
      }

      if (runCompletionState === "error") {
        throw new Error(`${actionLabel} reported an assistant error before the run completed.`);
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
  return page
    .locator('[data-testid="chat-tool-call"][data-tool-call-kind="tool"][data-tool-call-name="sql"][data-tool-call-status="completed"]')
    .evaluateAll((toolCallElements) => {
      function readRequiredAttribute(element: Element, attributeName: string): string {
        const attributeValue = element.getAttribute(attributeName);
        if (attributeValue === null || attributeValue.trim() === "") {
          throw new Error(`Missing AI tool-call contract attribute "${attributeName}".`);
        }

        return attributeValue.trim();
      }

      function readSectionText(
        toolCallElement: Element,
        sectionName: "input" | "output",
      ): string | null {
        const sectionElement = toolCallElement.querySelector(`[data-tool-call-section="${sectionName}"]`);
        if (sectionElement === null) {
          return null;
        }

        const contentText = sectionElement.querySelector("pre")?.textContent;
        if (contentText === undefined || contentText === null) {
          return null;
        }

        const trimmedContentText = contentText.trim();
        return trimmedContentText === "" ? null : trimmedContentText;
      }

      return toolCallElements.map((toolCallElement) => ({
        summary: readRequiredAttribute(toolCallElement, "data-tool-call-summary"),
        request: readSectionText(toolCallElement, "input"),
        response: readSectionText(toolCallElement, "output"),
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

async function readAiComposerContract(page: Page): Promise<AiComposerContract> {
  return page.getByTestId("chat-composer-state").evaluate((element) => {
    function readRequiredAttribute(attributeName: string): string {
      const attributeValue = element.getAttribute(attributeName);
      if (attributeValue === null || attributeValue.trim() === "") {
        throw new Error(`Missing AI composer contract attribute "${attributeName}".`);
      }

      return attributeValue.trim();
    }

    function readComposerState(attributeName: string): AiComposerState {
      const attributeValue = readRequiredAttribute(attributeName);
      if (
        attributeValue !== "idle"
        && attributeValue !== "preparingSend"
        && attributeValue !== "startingRun"
        && attributeValue !== "running"
        && attributeValue !== "stopping"
      ) {
        throw new Error(`Unsupported AI composer state "${attributeValue}".`);
      }

      return attributeValue;
    }

    function readComposerAction(attributeName: string): AiComposerAction {
      const attributeValue = readRequiredAttribute(attributeName);
      if (attributeValue !== "send" && attributeValue !== "stop") {
        throw new Error(`Unsupported AI composer action "${attributeValue}".`);
      }

      return attributeValue;
    }

    function readChatRunState(attributeName: string): AiChatRunState {
      const attributeValue = readRequiredAttribute(attributeName);
      if (attributeValue !== "idle" && attributeValue !== "running" && attributeValue !== "interrupted") {
        throw new Error(`Unsupported AI chat run state "${attributeValue}".`);
      }

      return attributeValue;
    }

    function readSendPhase(attributeName: string): AiSendPhase {
      const attributeValue = readRequiredAttribute(attributeName);
      if (attributeValue !== "idle" && attributeValue !== "preparingSend" && attributeValue !== "startingRun") {
        throw new Error(`Unsupported AI send phase "${attributeValue}".`);
      }

      return attributeValue;
    }

    function readDraftState(attributeName: string): AiDraftState {
      const attributeValue = readRequiredAttribute(attributeName);
      if (attributeValue !== "empty" && attributeValue !== "filled") {
        throw new Error(`Unsupported AI draft state "${attributeValue}".`);
      }

      return attributeValue;
    }

    function readCanSend(attributeName: string): AiCanSend {
      const attributeValue = readRequiredAttribute(attributeName);
      if (attributeValue !== "true" && attributeValue !== "false") {
        throw new Error(`Unsupported AI can-send state "${attributeValue}".`);
      }

      return attributeValue;
    }

    return {
      composerState: readComposerState("data-composer-state"),
      composerAction: readComposerAction("data-composer-action"),
      chatRunState: readChatRunState("data-chat-run-state"),
      sendPhase: readSendPhase("data-send-phase"),
      draftState: readDraftState("data-draft-state"),
      canSend: readCanSend("data-can-send"),
    };
  });
}

function isAiRunRunning(contract: AiComposerContract): boolean {
  return contract.composerState === "running"
    || contract.composerState === "stopping"
    || contract.composerAction === "stop"
    || contract.chatRunState === "running";
}

function isAiRunQueued(contract: AiComposerContract): boolean {
  return contract.composerState === "preparingSend"
    || contract.composerState === "startingRun"
    || contract.sendPhase === "preparingSend"
    || contract.sendPhase === "startingRun";
}

function isAiComposerTerminalIdle(contract: AiComposerContract): boolean {
  return contract.composerState === "idle"
    && contract.composerAction === "send"
    && contract.chatRunState !== "running"
    && contract.sendPhase === "idle"
    && contract.draftState === "empty"
    && contract.canSend === "false";
}
