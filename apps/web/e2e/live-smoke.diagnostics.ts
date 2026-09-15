import { writeFile } from "node:fs/promises";

import {
  type ConsoleMessage,
  type Page,
  type Request as PlaywrightRequest,
  type Response as PlaywrightResponse,
  type TestInfo,
} from "@playwright/test";

import { classifyAiTransportGetRequest } from "./support/aiTransport";

const failureSummaryTailSize = 25;
const redactedValuePlaceholder = "[redacted]";

/**
 * Failure diagnostics are uploaded as CI artifacts of a public repository, so
 * headers are captured through allowlists. Header names are kept because the
 * presence of a header is diagnostic, while values such as `Authorization`,
 * `X-CSRF-Token` or `Set-Cookie` are live credentials of the review account.
 * Both allowlists fail closed: an unlisted header keeps its name and loses its
 * value.
 */
const diagnosticRequestHeaderAllowlist: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-length",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "pragma",
  "purpose",
  "range",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "upgrade-insecure-requests",
  "x-chat-live-client-id",
  "x-chat-resume-attempt-id",
  "x-client-platform",
  "x-client-version",
]);

const diagnosticResponseHeaderAllowlist: ReadonlySet<string> = new Set([
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "etag",
  "x-amzn-requestid",
  "x-request-id",
]);

/**
 * Masks query values that carry a credential, such as the signature of a
 * presigned media URL, while keeping the URL itself readable.
 */
const sensitiveUrlParameterPattern = /token|signature|credential|secret|password|otp|code|key|sig|auth/i;

/**
 * Console messages and stacks embed URLs inside free text, and Chromium
 * forwards failed subresource loads as console messages carrying the full
 * request URL. Every embedded URL goes through the same query redaction.
 * The flags match `absoluteUrlPattern` in `apps/web/src/observability/instrument.ts`,
 * so a mixed-case scheme such as `HTTPS://` is redacted too.
 */
const embeddedUrlPattern = /https?:\/\/[^\s"'`<>\\]+/giu;

/**
 * An embedded URL usually ends a sentence or closes a bracket, and the greedy
 * match swallows that punctuation into the URL. It is split off before parsing
 * and restored afterwards, the way `splitTrailingUrlPunctuation` does in
 * `apps/web/src/observability/instrument.ts`, so stacks stay readable.
 */
const trailingUrlPunctuationPattern = /[),.;:!?]+$/u;

type DiagnosticTimelineEvent = "step_started" | "step_completed" | "action_started" | "action_completed";

type DiagnosticTimelineEntry = Readonly<{
  recordedAt: string;
  event: DiagnosticTimelineEvent;
  step: string | null;
  action: string | null;
  url: string;
}>;

export type DiagnosticStateSnapshot = Readonly<{
  currentTest: string | null;
  currentStep: string | null;
  currentStepStartedAt: string | null;
  currentAction: string | null;
  currentActionStartedAt: string | null;
  lastCompletedAction: string | null;
  lastCompletedActionAt: string | null;
  currentUrl: string;
}>;

type ConsoleDiagnosticEvent = Readonly<{
  recordedAt: string;
  step: string | null;
  action: string | null;
  pageUrl: string;
  messageType: string;
  text: string;
  location: string | null;
}>;

type PageErrorDiagnosticEvent = Readonly<{
  recordedAt: string;
  step: string | null;
  action: string | null;
  pageUrl: string;
  message: string;
  stack: string | null;
}>;

type NetworkDiagnosticEvent = Readonly<{
  recordedAt: string;
  kind: "request" | "response" | "requestfailed";
  step: string | null;
  action: string | null;
  pageUrl: string;
  requestUrl: string;
  method: string;
  resourceType: string;
  requestHeaders: Readonly<Record<string, string | undefined>>;
  responseHeaders: Readonly<Record<string, string | undefined>> | null;
  isNavigationRequest: boolean;
  status: number | null;
  statusText: string | null;
  ok: boolean | null;
  failureText: string | null;
}>;

type FailureDiagnosticRecord = Readonly<{
  currentTest: string | null;
  primaryErrorMessage: string;
  primaryErrorStack: string | null;
  currentStep: string | null;
  currentStepStartedAt: string | null;
  currentAction: string | null;
  currentActionStartedAt: string | null;
  lastCompletedAction: string | null;
  lastCompletedActionAt: string | null;
  currentUrl: string;
  actionTimeline: ReadonlyArray<DiagnosticTimelineEntry>;
  consoleEvents: ReadonlyArray<ConsoleDiagnosticEvent>;
  pageErrors: ReadonlyArray<PageErrorDiagnosticEvent>;
  networkEvents: ReadonlyArray<NetworkDiagnosticEvent>;
}>;

type MutableDiagnosticState = {
  currentTest: string | null;
  currentStep: string | null;
  currentStepStartedAt: string | null;
  currentAction: string | null;
  currentActionStartedAt: string | null;
  lastCompletedAction: string | null;
  lastCompletedActionAt: string | null;
  currentUrl: string;
};

export type LiveSmokeDiagnostics = Readonly<{
  startTest: (testName: string) => void;
  startStep: (stepName: string) => void;
  completeStep: (stepName: string) => void;
  runAction: <T>(actionName: string, operation: () => Promise<T>) => Promise<T>;
  getStateSnapshot: () => DiagnosticStateSnapshot;
  attachFailureDetails: (testInfo: TestInfo, error: Error) => Promise<void>;
}>;

export function createLiveSmokeDiagnostics(page: Page): LiveSmokeDiagnostics {
  const actionTimeline: DiagnosticTimelineEntry[] = [];
  const consoleEvents: ConsoleDiagnosticEvent[] = [];
  const pageErrors: PageErrorDiagnosticEvent[] = [];
  const networkEvents: NetworkDiagnosticEvent[] = [];
  const state: MutableDiagnosticState = {
    currentTest: null,
    currentStep: null,
    currentStepStartedAt: null,
    currentAction: null,
    currentActionStartedAt: null,
    lastCompletedAction: null,
    lastCompletedActionAt: null,
    currentUrl: readPageUrl(page, "about:blank"),
  };
  let hasPrintedInlineRawScreenState = false;

  function refreshCurrentUrl(): string {
    state.currentUrl = readPageUrl(page, state.currentUrl);
    return state.currentUrl;
  }

  function getStateSnapshot(): DiagnosticStateSnapshot {
    return {
      currentTest: state.currentTest,
      currentStep: state.currentStep,
      currentStepStartedAt: state.currentStepStartedAt,
      currentAction: state.currentAction,
      currentActionStartedAt: state.currentActionStartedAt,
      lastCompletedAction: state.lastCompletedAction,
      lastCompletedActionAt: state.lastCompletedActionAt,
      currentUrl: refreshCurrentUrl(),
    };
  }

  function recordTimeline(event: DiagnosticTimelineEvent, step: string | null, action: string | null): void {
    actionTimeline.push({
      recordedAt: nowIsoString(),
      event,
      step,
      action,
      url: refreshCurrentUrl(),
    });
  }

  function startTest(testName: string): void {
    state.currentTest = testName;
    state.currentStep = null;
    state.currentStepStartedAt = null;
    state.currentAction = null;
    state.currentActionStartedAt = null;
    state.lastCompletedAction = null;
    state.lastCompletedActionAt = null;
    hasPrintedInlineRawScreenState = false;
  }

  function captureContext(): DiagnosticStateSnapshot {
    return getStateSnapshot();
  }

  page.on("console", (message: ConsoleMessage) => {
    const snapshot = captureContext();
    consoleEvents.push({
      recordedAt: nowIsoString(),
      step: snapshot.currentStep,
      action: snapshot.currentAction,
      pageUrl: snapshot.currentUrl,
      messageType: message.type(),
      text: redactUrlsInText(message.text()),
      location: formatConsoleLocation(message),
    });
  });

  page.on("pageerror", (error: Error) => {
    const snapshot = captureContext();
    pageErrors.push({
      recordedAt: nowIsoString(),
      step: snapshot.currentStep,
      action: snapshot.currentAction,
      pageUrl: snapshot.currentUrl,
      message: redactUrlsInText(error.message),
      stack: error.stack === undefined ? null : redactUrlsInText(error.stack),
    });
  });

  page.on("request", (request: PlaywrightRequest) => {
    const snapshot = captureContext();
    networkEvents.push({
      recordedAt: nowIsoString(),
      kind: "request",
      step: snapshot.currentStep,
      action: snapshot.currentAction,
      pageUrl: snapshot.currentUrl,
      requestUrl: redactUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: redactRequestHeaders(request.headers()),
      responseHeaders: null,
      isNavigationRequest: request.isNavigationRequest(),
      status: null,
      statusText: null,
      ok: null,
      failureText: null,
    });
  });

  page.on("response", (response: PlaywrightResponse) => {
    const snapshot = captureContext();
    const request = response.request();
    networkEvents.push({
      recordedAt: nowIsoString(),
      kind: "response",
      step: snapshot.currentStep,
      action: snapshot.currentAction,
      pageUrl: snapshot.currentUrl,
      requestUrl: redactUrl(response.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: redactRequestHeaders(request.headers()),
      responseHeaders: redactResponseHeaders(response.headers()),
      isNavigationRequest: request.isNavigationRequest(),
      status: response.status(),
      statusText: response.statusText(),
      ok: response.ok(),
      failureText: null,
    });
  });

  page.on("requestfailed", (request: PlaywrightRequest) => {
    const snapshot = captureContext();
    networkEvents.push({
      recordedAt: nowIsoString(),
      kind: "requestfailed",
      step: snapshot.currentStep,
      action: snapshot.currentAction,
      pageUrl: snapshot.currentUrl,
      requestUrl: redactUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: redactRequestHeaders(request.headers()),
      responseHeaders: null,
      isNavigationRequest: request.isNavigationRequest(),
      status: null,
      statusText: null,
      ok: false,
      failureText: request.failure()?.errorText ?? "Request failed without an error message",
    });
  });

  function startStep(stepName: string): void {
    state.currentStep = stepName;
    state.currentStepStartedAt = nowIsoString();
    recordTimeline("step_started", stepName, null);
  }

  function completeStep(stepName: string): void {
    recordTimeline("step_completed", stepName, null);
  }

  async function runAction<T>(actionName: string, operation: () => Promise<T>): Promise<T> {
    const stepName = state.currentStep;
    state.currentAction = actionName;
    state.currentActionStartedAt = nowIsoString();
    recordTimeline("action_started", stepName, actionName);

    try {
      const result = await operation();
      state.lastCompletedAction = actionName;
      state.lastCompletedActionAt = nowIsoString();
      state.currentAction = null;
      state.currentActionStartedAt = null;
      recordTimeline("action_completed", stepName, actionName);
      return result;
    } catch (error) {
      await emitInlineRawScreenState(page, getStateSnapshot(), hasPrintedInlineRawScreenState);
      hasPrintedInlineRawScreenState = true;
      throw createTrackedActionError(stepName, actionName, error);
    }
  }

  async function attachFailureDetails(testInfo: TestInfo, error: Error): Promise<void> {
    const snapshot = getStateSnapshot();
    await emitInlineRawScreenState(page, snapshot, hasPrintedInlineRawScreenState);
    hasPrintedInlineRawScreenState = true;
    const failureRecord: FailureDiagnosticRecord = {
      currentTest: snapshot.currentTest,
      primaryErrorMessage: redactUrlsInText(error.message),
      primaryErrorStack: error.stack === undefined ? null : redactUrlsInText(error.stack),
      currentStep: snapshot.currentStep,
      currentStepStartedAt: snapshot.currentStepStartedAt,
      currentAction: snapshot.currentAction,
      currentActionStartedAt: snapshot.currentActionStartedAt,
      lastCompletedAction: snapshot.lastCompletedAction,
      lastCompletedActionAt: snapshot.lastCompletedActionAt,
      currentUrl: snapshot.currentUrl,
      actionTimeline,
      consoleEvents,
      pageErrors,
      networkEvents,
    };

    // Playwright keeps `body` attachments in memory, so they only ever reach the
    // HTML report as hashed blobs. Writing them into the test output directory
    // is what makes them land in the uploaded CI artifacts under their own name.
    const diagnosticsPath = testInfo.outputPath("failure-diagnostics.json");
    await writeFile(diagnosticsPath, JSON.stringify(failureRecord, null, 2), "utf8");
    await testInfo.attach("failure-diagnostics.json", {
      path: diagnosticsPath,
      contentType: "application/json",
    });

    const summaryPath = testInfo.outputPath("failure-summary.txt");
    await writeFile(summaryPath, buildFailureSummary(failureRecord), "utf8");
    await testInfo.attach("failure-summary.txt", {
      path: summaryPath,
      contentType: "text/plain",
    });
  }

  return {
    startTest,
    startStep,
    completeStep,
    runAction,
    getStateSnapshot,
    attachFailureDetails,
  };
}

export async function attachPageSnapshot(
  page: Page,
  testInfo: TestInfo,
  fileNamePrefix: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  const snapshotState = diagnostics.getStateSnapshot();
  const captureNotes: string[] = [];

  await testInfo.attach(`${fileNamePrefix}-state.txt`, {
    body: buildSnapshotState(snapshotState, page),
    contentType: "text/plain",
  });

  if (page.isClosed()) {
    captureNotes.push("Page is already closed. HTML, screenshot, and DOM capture were skipped.");
  } else {
    try {
      await testInfo.attach(`${fileNamePrefix}.html`, {
        body: await page.content(),
        contentType: "text/html",
      });
    } catch (error) {
      captureNotes.push(`Unable to capture page HTML: ${getErrorMessage(error)}`);
    }

    try {
      const screenshotPath = testInfo.outputPath(`${fileNamePrefix}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      await testInfo.attach(`${fileNamePrefix}.png`, {
        path: screenshotPath,
        contentType: "image/png",
      });
    } catch (error) {
      captureNotes.push(`Unable to capture screenshot: ${getErrorMessage(error)}`);
    }

    try {
      const domHtml = await page.evaluate(() => document.documentElement.outerHTML);
      await testInfo.attach(`${fileNamePrefix}-dom.html`, {
        body: domHtml,
        contentType: "text/html",
      });
    } catch (error) {
      captureNotes.push(`Unable to capture DOM HTML: ${getErrorMessage(error)}`);
    }
  }

  if (captureNotes.length > 0) {
    await testInfo.attach(`${fileNamePrefix}-capture-notes.txt`, {
      body: captureNotes.join("\n"),
      contentType: "text/plain",
    });
  }
}

function redactRequestHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return redactHeaders(headers, diagnosticRequestHeaderAllowlist);
}

function redactResponseHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return redactHeaders(headers, diagnosticResponseHeaderAllowlist);
}

function redactHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  allowlist: ReadonlySet<string>,
): Readonly<Record<string, string | undefined>> {
  const redactedHeaders: Record<string, string | undefined> = {};

  for (const [name, value] of Object.entries(headers)) {
    redactedHeaders[name] = allowlist.has(name.toLowerCase())
      ? value
      : redactedValuePlaceholder;
  }

  return redactedHeaders;
}

function redactUrlsInText(text: string): string {
  return text.replace(embeddedUrlPattern, (embeddedUrl) => {
    const trailingMatch = embeddedUrl.match(trailingUrlPunctuationPattern);
    if (trailingMatch === null || trailingMatch.index === undefined) {
      return redactUrl(embeddedUrl);
    }

    return `${redactUrl(embeddedUrl.slice(0, trailingMatch.index))}${trailingMatch[0]}`;
  });
}

function redactUrl(rawUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  // The query is masked by parameter name rather than cleared wholesale because
  // the record is read through its query strings: `classifyAiTransportGetRequest`
  // and parameters such as `sessionId`, `runId` and `afterCursor` are the
  // evidence this artifact exists to carry. The fragment and the `user:password@`
  // user info have no such reader and can carry a credential, and `toString()`
  // would preserve both, so all three are dropped entirely. The host, path and
  // port are kept, because they are what the artifact is read for.
  for (const parameterName of [...parsedUrl.searchParams.keys()]) {
    if (sensitiveUrlParameterPattern.test(parameterName)) {
      parsedUrl.searchParams.set(parameterName, redactedValuePlaceholder);
    }
  }

  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.hash = "";

  return parsedUrl.toString();
}

export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readPageUrl(page: Page, lastKnownUrl: string): string {
  if (page.isClosed()) {
    return lastKnownUrl;
  }

  const currentUrl = page.url();
  return currentUrl === "" ? lastKnownUrl : redactUrl(currentUrl);
}

function createTrackedActionError(stepName: string | null, actionName: string, error: unknown): Error {
  const originalError = normalizeError(error);
  return new Error(
    `Live smoke failed in step "${stepName ?? "unknown"}" at action "${actionName}": ${originalError.message}`,
    { cause: originalError },
  );
}

function buildFailureSummary(record: FailureDiagnosticRecord): string {
  const recentTimeline = record.actionTimeline.slice(-failureSummaryTailSize);
  const recentConsoleEvents = record.consoleEvents.slice(-failureSummaryTailSize);
  const recentNetworkEvents = record.networkEvents.slice(-failureSummaryTailSize);
  const chatRequestSummary = summarizeAiTransportRequests(record.networkEvents);

  return [
    `Current test: ${record.currentTest ?? "unknown"}`,
    `Primary error: ${record.primaryErrorMessage}`,
    `Current step: ${record.currentStep ?? "unknown"}`,
    `Current step started at: ${record.currentStepStartedAt ?? "unknown"}`,
    `Current action: ${record.currentAction ?? "none"}`,
    `Current action started at: ${record.currentActionStartedAt ?? "unknown"}`,
    `Last completed action: ${record.lastCompletedAction ?? "none"}`,
    `Last completed action at: ${record.lastCompletedActionAt ?? "unknown"}`,
    `Current URL: ${record.currentUrl}`,
    `Timeline entries: ${record.actionTimeline.length}`,
    `Console events: ${record.consoleEvents.length}`,
    `Page errors: ${record.pageErrors.length}`,
    `Network events: ${record.networkEvents.length}`,
    `AI live attach requests: ${String(chatRequestSummary.liveAttachRequestCount)}`,
    `AI snapshot poll requests: ${String(chatRequestSummary.snapshotPollRequestCount)}`,
    `AI session-less snapshot requests: ${String(chatRequestSummary.sessionlessChatSnapshotRequestCount)}`,
    "",
    "Recent timeline:",
    ...formatTimelineEntries(recentTimeline),
    "",
    "Recent console events:",
    ...formatConsoleEvents(recentConsoleEvents),
    "",
    "Page errors:",
    ...formatPageErrors(record.pageErrors),
    "",
    "Recent network events:",
    ...formatNetworkEvents(recentNetworkEvents),
    "",
    "Primary stack:",
    record.primaryErrorStack ?? "No stack available",
  ].join("\n");
}

type AiTransportRequestSummary = Readonly<{
  liveAttachRequestCount: number;
  snapshotPollRequestCount: number;
  sessionlessChatSnapshotRequestCount: number;
}>;

function summarizeAiTransportRequests(
  events: ReadonlyArray<NetworkDiagnosticEvent>,
): AiTransportRequestSummary {
  return events.reduce<AiTransportRequestSummary>((summary, event) => {
    if (event.kind !== "request") {
      return summary;
    }

    const requestKind = classifyAiTransportGetRequest({
      method: event.method,
      url: event.requestUrl,
      resourceType: event.resourceType,
      headers: event.requestHeaders,
    });

    return {
      liveAttachRequestCount: summary.liveAttachRequestCount + (requestKind === "live_attach" ? 1 : 0),
      snapshotPollRequestCount: summary.snapshotPollRequestCount + (requestKind === "snapshot_poll" ? 1 : 0),
      sessionlessChatSnapshotRequestCount: summary.sessionlessChatSnapshotRequestCount + (requestKind === "sessionless_chat_snapshot" ? 1 : 0),
    };
  }, {
    liveAttachRequestCount: 0,
    snapshotPollRequestCount: 0,
    sessionlessChatSnapshotRequestCount: 0,
  });
}

function formatTimelineEntries(entries: ReadonlyArray<DiagnosticTimelineEntry>): string[] {
  if (entries.length === 0) {
    return ["(none)"];
  }

  return entries.map((entry) => {
    return `${entry.recordedAt} ${entry.event} step=${entry.step ?? "unknown"} action=${entry.action ?? "none"} url=${entry.url}`;
  });
}

function formatConsoleEvents(events: ReadonlyArray<ConsoleDiagnosticEvent>): string[] {
  if (events.length === 0) {
    return ["(none)"];
  }

  return events.map((event) => {
    const locationSuffix = event.location === null ? "" : ` location=${event.location}`;
    return `${event.recordedAt} ${event.messageType} step=${event.step ?? "unknown"} action=${event.action ?? "none"} page=${event.pageUrl}${locationSuffix} text=${event.text}`;
  });
}

function formatPageErrors(events: ReadonlyArray<PageErrorDiagnosticEvent>): string[] {
  if (events.length === 0) {
    return ["(none)"];
  }

  return events.map((event) => {
    return `${event.recordedAt} step=${event.step ?? "unknown"} action=${event.action ?? "none"} page=${event.pageUrl} message=${event.message}`;
  });
}

function formatNetworkEvents(events: ReadonlyArray<NetworkDiagnosticEvent>): string[] {
  if (events.length === 0) {
    return ["(none)"];
  }

  return events.map((event) => {
    // `contentType` and `cacheControl` separate a real asset from the static
    // server's `index.html` fallback, which also answers `200`.
    const contentType = event.responseHeaders?.["content-type"] ?? null;
    const cacheControl = event.responseHeaders?.["cache-control"] ?? null;
    const responseBits = [
      event.status === null ? null : `status=${String(event.status)}`,
      event.statusText === null ? null : `statusText=${event.statusText}`,
      event.ok === null ? null : `ok=${String(event.ok)}`,
      contentType === null ? null : `contentType=${contentType}`,
      cacheControl === null ? null : `cacheControl=${cacheControl}`,
      event.failureText === null ? null : `failure=${event.failureText}`,
    ].filter((value): value is string => value !== null);

    return [
      `${event.recordedAt}`,
      event.kind,
      `step=${event.step ?? "unknown"}`,
      `action=${event.action ?? "none"}`,
      `page=${event.pageUrl}`,
      `method=${event.method}`,
      `resourceType=${event.resourceType}`,
      `navigation=${String(event.isNavigationRequest)}`,
      `url=${event.requestUrl}`,
      ...responseBits,
    ].join(" ");
  });
}

function buildSnapshotState(snapshotState: DiagnosticStateSnapshot, page: Page): string {
  return [
    `capturedAt: ${nowIsoString()}`,
    `pageClosed: ${String(page.isClosed())}`,
    `currentTest: ${snapshotState.currentTest ?? "unknown"}`,
    `currentUrl: ${snapshotState.currentUrl}`,
    `currentStep: ${snapshotState.currentStep ?? "unknown"}`,
    `currentStepStartedAt: ${snapshotState.currentStepStartedAt ?? "unknown"}`,
    `currentAction: ${snapshotState.currentAction ?? "none"}`,
    `currentActionStartedAt: ${snapshotState.currentActionStartedAt ?? "unknown"}`,
    `lastCompletedAction: ${snapshotState.lastCompletedAction ?? "none"}`,
    `lastCompletedActionAt: ${snapshotState.lastCompletedActionAt ?? "unknown"}`,
  ].join("\n");
}

async function emitInlineRawScreenState(
  page: Page,
  snapshotState: DiagnosticStateSnapshot,
  hasPrintedInlineRawScreenState: boolean,
): Promise<void> {
  if (hasPrintedInlineRawScreenState) {
    return;
  }

  const rawScreenStateBlock = await buildRawScreenStateBlock(page, snapshotState);
  process.stderr.write(`${rawScreenStateBlock}\n`);
}

async function buildRawScreenStateBlock(
  page: Page,
  snapshotState: DiagnosticStateSnapshot,
): Promise<string> {
  const rawDump = await captureRawWebScreenState(page);

  return [
    "===== BEGIN RAW SCREEN STATE =====",
    "platform: web",
    `test: ${snapshotState.currentTest ?? "unknown"}`,
    `step: ${snapshotState.currentStep ?? "unknown"}`,
    `action: ${snapshotState.currentAction ?? "none"}`,
    `capturedAt: ${nowIsoString()}`,
    `context: url=${snapshotState.currentUrl} pageClosed=${String(page.isClosed())}`,
    "",
    `activeElement: ${rawDump.activeElementSummary}`,
    "",
    "bodyInnerText:",
    rawDump.bodyInnerText,
    "",
    "bodyOuterHTML:",
    rawDump.bodyOuterHtml,
    "===== END RAW SCREEN STATE =====",
  ].join("\n");
}

async function captureRawWebScreenState(page: Page): Promise<{
  activeElementSummary: string;
  bodyInnerText: string;
  bodyOuterHtml: string;
}> {
  if (page.isClosed()) {
    return {
      activeElementSummary: "<page closed>",
      bodyInnerText: "<page closed>",
      bodyOuterHtml: "<page closed>",
    };
  }

  try {
    return await page.evaluate(() => {
      const activeElement = document.activeElement;
      const activeElementSummary = activeElement === null
        ? "<none>"
        : [
            activeElement.tagName.toLowerCase(),
            activeElement.id === "" ? null : `id=${activeElement.id}`,
            activeElement.getAttribute("role"),
            activeElement.getAttribute("aria-label"),
            activeElement.getAttribute("name"),
            activeElement.textContent?.trim() === "" ? null : activeElement.textContent?.trim(),
          ]
            .filter((value): value is string => value !== null && value !== "")
            .join(" ");

      return {
        activeElementSummary,
        bodyInnerText: document.body?.innerText ?? "<document.body missing>",
        bodyOuterHtml: document.body?.outerHTML ?? "<document.body missing>",
      };
    });
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      activeElementSummary: `<capture failed: ${message}>`,
      bodyInnerText: `<capture failed: ${message}>`,
      bodyOuterHtml: `<capture failed: ${message}>`,
    };
  }
}

function formatConsoleLocation(message: ConsoleMessage): string | null {
  const location = message.location();
  if (location.url === "" && location.lineNumber === 0 && location.columnNumber === 0) {
    return null;
  }

  return `${redactUrl(location.url)}:${location.lineNumber + 1}:${location.columnNumber + 1}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIsoString(): string {
  return new Date().toISOString();
}
