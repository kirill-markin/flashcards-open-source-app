import {
  expect,
  test,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request as PlaywrightRequest,
  type Response as PlaywrightResponse,
  type TestInfo,
} from "@playwright/test";

const localUiTimeoutMs = 10_000;
const externalUiTimeoutMs = 30_000;
const failureSummaryTailSize = 25;

const reviewEmail = process.env.FLASHCARDS_LIVE_REVIEW_EMAIL ?? "google-review@example.com";
const authBaseUrl = process.env.FLASHCARDS_E2E_AUTH_BASE_URL ?? "https://auth.flashcards-open-source-app.com";

type LiveSmokeScenario = Readonly<{
  workspaceName: string;
  manualFrontText: string;
  manualBackText: string;
  aiFrontText: string;
  aiBackText: string;
  markerTag: string;
}>;

type DiagnosticTimelineEvent = "step_started" | "step_completed" | "action_started" | "action_completed";

type DiagnosticTimelineEntry = Readonly<{
  recordedAt: string;
  event: DiagnosticTimelineEvent;
  step: string | null;
  action: string | null;
  url: string;
}>;

type DiagnosticStateSnapshot = Readonly<{
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
  isNavigationRequest: boolean;
  status: number | null;
  statusText: string | null;
  ok: boolean | null;
  failureText: string | null;
}>;

type FailureDiagnosticRecord = Readonly<{
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
  currentStep: string | null;
  currentStepStartedAt: string | null;
  currentAction: string | null;
  currentActionStartedAt: string | null;
  lastCompletedAction: string | null;
  lastCompletedActionAt: string | null;
  currentUrl: string;
};

type LiveSmokeDiagnostics = Readonly<{
  startStep: (stepName: string) => void;
  completeStep: (stepName: string) => void;
  runAction: <T>(actionName: string, operation: () => Promise<T>) => Promise<T>;
  getStateSnapshot: () => DiagnosticStateSnapshot;
  attachFailureDetails: (testInfo: TestInfo, error: Error) => Promise<void>;
}>;

/**
 * This smoke test intentionally keeps one connected, stateful story in a
 * single browser session. The workspace name and card texts are unique for
 * each run so the scenario can fail fast at the exact cross-screen step that
 * regressed without depending on any other test cleanup.
 */
test("live smoke flow uses the real demo account across review, cards, AI, and settings", async ({
  page,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) {
    throw new Error("Playwright baseURL is required for the live smoke flow");
  }

  const scenario = buildScenario(runIdFrom(testInfo));
  const diagnostics = createLiveSmokeDiagnostics(page);
  let primaryFailure: Error | null = null;

  try {
    await runTrackedTestStep(diagnostics, "sign in with the configured review account", async () => {
      await signInWithReviewAccount(page, baseURL, reviewEmail, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "create an isolated linked workspace for this run", async () => {
      await createEphemeralWorkspace(page, scenario.workspaceName, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "create one manual card", async () => {
      await createManualCard(page, scenario.manualFrontText, scenario.manualBackText, scenario.markerTag, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "verify the manual card in cards and review it", async () => {
      await assertCardVisibleInCards(page, scenario.manualFrontText, diagnostics);
      await reviewCardFromQueue(page, scenario.manualFrontText, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "reload the browser and keep the linked session", async () => {
      await restartAndAssertLinkedSession(page, scenario.workspaceName, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "create one AI card with explicit confirmation", async () => {
      await runAiCardCreationWithConfirmation(
        page,
        scenario.aiFrontText,
        scenario.aiBackText,
        scenario.markerTag,
        diagnostics,
      );
    });

    await runTrackedTestStep(diagnostics, "verify the AI-created card is visible in cards and review", async () => {
      await assertCardVisibleInCards(page, scenario.aiFrontText, diagnostics);
      await assertCardReachableInReview(page, scenario.aiFrontText, diagnostics);
    });

    await runTrackedTestStep(diagnostics, "verify linked account status and workspace state", async () => {
      await assertLinkedAccountStatus(page, reviewEmail, scenario.workspaceName, diagnostics);
    });
  } catch (error) {
    primaryFailure = normalizeError(error);
    await diagnostics.attachFailureDetails(testInfo, primaryFailure);
    throw error;
  } finally {
    await attachPageSnapshot(page, testInfo, "final-page", diagnostics);

    try {
      await runTrackedTestStep(diagnostics, "delete the isolated workspace", async () => {
        await deleteEphemeralWorkspace(page, scenario.workspaceName, diagnostics);
      });
    } catch (error) {
      const cleanupError = normalizeError(error);
      await attachPageSnapshot(page, testInfo, "cleanup-failure-page", diagnostics);

      if (primaryFailure !== null) {
        await testInfo.attach("cleanup-failure.txt", {
          body: cleanupError.stack ?? cleanupError.message,
          contentType: "text/plain",
        });
      } else {
        await diagnostics.attachFailureDetails(testInfo, cleanupError);
        throw cleanupError;
      }
    }
  }
});

function runIdFrom(testInfo: TestInfo): string {
  return `${testInfo.parallelIndex}-${Date.now()}`;
}

function buildScenario(runId: string): LiveSmokeScenario {
  return {
    workspaceName: `E2E web ${runId}`,
    manualFrontText: `Manual e2e web ${runId}`,
    manualBackText: `Manual answer e2e web ${runId}`,
    aiFrontText: `AI e2e web ${runId}`,
    aiBackText: `AI answer e2e web ${runId}`,
    markerTag: `e2e-web-${runId}`,
  };
}

function buildLoginUrl(appBaseUrl: string): string {
  const redirectUri = `${appBaseUrl}/review`;
  return `${authBaseUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

function createLiveSmokeDiagnostics(page: Page): LiveSmokeDiagnostics {
  const actionTimeline: DiagnosticTimelineEntry[] = [];
  const consoleEvents: ConsoleDiagnosticEvent[] = [];
  const pageErrors: PageErrorDiagnosticEvent[] = [];
  const networkEvents: NetworkDiagnosticEvent[] = [];
  const state: MutableDiagnosticState = {
    currentStep: null,
    currentStepStartedAt: null,
    currentAction: null,
    currentActionStartedAt: null,
    lastCompletedAction: null,
    lastCompletedActionAt: null,
    currentUrl: readPageUrl(page, "about:blank"),
  };

  function refreshCurrentUrl(): string {
    state.currentUrl = readPageUrl(page, state.currentUrl);
    return state.currentUrl;
  }

  function getStateSnapshot(): DiagnosticStateSnapshot {
    return {
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
      text: message.text(),
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
      message: error.message,
      stack: error.stack ?? null,
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
      requestUrl: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
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
      requestUrl: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
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
      requestUrl: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
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
      throw createTrackedActionError(stepName, actionName, error);
    }
  }

  async function attachFailureDetails(testInfo: TestInfo, error: Error): Promise<void> {
    const snapshot = getStateSnapshot();
    const failureRecord: FailureDiagnosticRecord = {
      primaryErrorMessage: error.message,
      primaryErrorStack: error.stack ?? null,
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

    await testInfo.attach("failure-diagnostics.json", {
      body: JSON.stringify(failureRecord, null, 2),
      contentType: "application/json",
    });

    await testInfo.attach("failure-summary.txt", {
      body: buildFailureSummary(failureRecord),
      contentType: "text/plain",
    });
  }

  return {
    startStep,
    completeStep,
    runAction,
    getStateSnapshot,
    attachFailureDetails,
  };
}

async function runTrackedTestStep(
  diagnostics: LiveSmokeDiagnostics,
  stepName: string,
  body: () => Promise<void>,
): Promise<void> {
  diagnostics.startStep(stepName);
  await test.step(stepName, async () => {
    await body();
  });
  diagnostics.completeStep(stepName);
}

async function signInWithReviewAccount(
  page: Page,
  appBaseUrl: string,
  email: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedGoto(
    page,
    diagnostics,
    `open auth login page for ${email}`,
    buildLoginUrl(appBaseUrl),
    externalUiTimeoutMs,
  );
  await trackedFill(diagnostics, `fill review account email ${email}`, page.getByLabel("Email"), email);
  await trackedClick(diagnostics, "submit review account email", page.getByRole("button", { name: "Send code" }));
  await trackedWaitForUrl(
    page,
    diagnostics,
    "wait for review redirect after auth",
    new RegExp(`^${escapeRegExp(`${appBaseUrl}/review`)}`),
    externalUiTimeoutMs,
  );

  const chooseWorkspaceHeading = page.getByRole("heading", { name: "Choose workspace" });
  const chooseWorkspaceVisible = await trackedIsVisible(
    diagnostics,
    "check whether auth restored into the workspace chooser",
    chooseWorkspaceHeading,
  );
  if (chooseWorkspaceVisible) {
    await trackedClick(
      diagnostics,
      "select the first linked workspace from the workspace chooser",
      page.locator(".workspace-choice-btn").first(),
    );
  }

  await trackedExpectVisible(
    diagnostics,
    "confirm primary navigation is visible after auth",
    page.getByRole("navigation", { name: "Primary" }),
    localUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm review navigation link is visible after auth",
    page.getByRole("link", { name: "Review" }),
    localUiTimeoutMs,
  );
}

async function createEphemeralWorkspace(
  page: Page,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open settings navigation", page.getByRole("link", { name: "Settings" }));
  await trackedClick(diagnostics, "open current workspace settings", page.getByRole("link", { name: "Current Workspace" }));
  await trackedClick(diagnostics, "expand workspace picker card", page.getByRole("button", { name: "Workspace" }));
  await trackedClick(diagnostics, "open new workspace form", page.getByRole("button", { name: "New Workspace" }));
  await trackedFill(diagnostics, `fill workspace name ${workspaceName}`, page.getByPlaceholder("Workspace name"), workspaceName);
  await trackedClick(diagnostics, `submit workspace creation for ${workspaceName}`, page.getByRole("button", { name: "Create Workspace" }));
  await trackedExpectText(
    diagnostics,
    `confirm topbar switched to workspace ${workspaceName}`,
    page.locator(".topbar-workspace"),
    workspaceName,
    externalUiTimeoutMs,
  );
}

async function createManualCard(
  page: Page,
  frontText: string,
  backText: string,
  markerTag: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open cards navigation", page.getByRole("link", { name: "Cards" }));
  await trackedClick(diagnostics, "open new card screen", page.getByRole("link", { name: "New card" }));
  await trackedFill(diagnostics, `fill card front text ${frontText}`, page.getByLabel("Front"), frontText);
  await trackedFill(diagnostics, `fill card back text ${backText}`, page.getByLabel("Back"), backText);
  await trackedClick(diagnostics, "focus tag editor", page.getByText("Click to add tags"));
  await trackedFill(diagnostics, `fill card tag ${markerTag}`, page.getByPlaceholder("Type and press Enter"), markerTag);
  await trackedPress(page, diagnostics, `confirm tag ${markerTag}`, "Enter");
  await trackedClick(diagnostics, "blur tag editor by clicking new card heading", page.getByRole("heading", { name: "New card" }));
  await trackedClick(diagnostics, "submit manual card", page.getByRole("button", { name: "Save card" }));
  await trackedExpectVisible(
    diagnostics,
    "confirm cards heading is visible after manual card save",
    page.getByRole("heading", { name: "Cards" }),
    externalUiTimeoutMs,
  );
}

async function assertCardVisibleInCards(
  page: Page,
  searchText: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open cards navigation for verification", page.getByRole("link", { name: "Cards" }));
  const searchInput = page.getByPlaceholder("Search front, back, or tags");
  await trackedFill(diagnostics, "clear cards search input", searchInput, "");
  await trackedFill(diagnostics, `fill cards search input with ${searchText}`, searchInput, searchText);
  await trackedExpectVisible(
    diagnostics,
    `confirm cards list shows ${searchText}`,
    page.getByText(searchText, { exact: true }),
    localUiTimeoutMs,
  );
}

async function reviewCardFromQueue(
  page: Page,
  expectedFrontText: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open review navigation", page.getByRole("link", { name: "Review" }));
  await trackedExpectVisible(
    diagnostics,
    `confirm review queue shows ${expectedFrontText}`,
    page.getByText(expectedFrontText, { exact: true }),
    localUiTimeoutMs,
  );
  await trackedClick(diagnostics, "reveal review answer", page.getByRole("button", { name: "Reveal answer" }));
  await trackedClick(diagnostics, "submit Good review answer", page.getByRole("button", { name: "Good" }));
  await diagnostics.runAction(`confirm review queue moved past ${expectedFrontText}`, async () => {
    await expect.poll(
      async () => page.locator(".review-pane").innerText(),
      { timeout: localUiTimeoutMs },
    ).not.toContain(expectedFrontText);
  });
}

async function restartAndAssertLinkedSession(
  page: Page,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedReload(page, diagnostics, "reload the app shell and wait for DOM content", externalUiTimeoutMs);
  await trackedExpectVisible(
    diagnostics,
    "confirm primary navigation is visible after reload",
    page.getByRole("navigation", { name: "Primary" }),
    externalUiTimeoutMs,
  );
  await trackedExpectText(
    diagnostics,
    `confirm topbar workspace persisted as ${workspaceName} after reload`,
    page.locator(".topbar-workspace"),
    workspaceName,
    externalUiTimeoutMs,
  );
}

async function runAiCardCreationWithConfirmation(
  page: Page,
  aiFrontText: string,
  aiBackText: string,
  markerTag: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open AI chat navigation", page.getByRole("link", { name: "AI chat" }));
  const messageField = page.getByPlaceholder("Ask about cards, review history, or attach notes...");

  await trackedFill(
    diagnostics,
    "fill AI prompt for exactly one flashcard proposal",
    messageField,
    `Prepare exactly one flashcard proposal. Use front text "${aiFrontText}", back text "${aiBackText}", and include tag "${markerTag}". Wait for my confirmation before creating it.`,
  );
  await trackedClick(diagnostics, "send AI proposal request", page.getByRole("button", { name: "Send message" }));
  await trackedExpectVisible(
    diagnostics,
    `confirm AI proposal mentions ${aiFrontText}`,
    page.getByText(aiFrontText, { exact: false }),
    externalUiTimeoutMs,
  );

  await trackedFill(diagnostics, "fill AI confirmation message", messageField, "Confirmed. Create the card exactly as proposed.");
  await trackedClick(diagnostics, "send AI confirmation", page.getByRole("button", { name: "Send message" }));
  await trackedExpectVisible(
    diagnostics,
    "confirm AI reports card creation done",
    page.getByText("Done"),
    externalUiTimeoutMs,
  );
}

async function assertCardReachableInReview(
  page: Page,
  expectedFrontText: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open review navigation for AI card verification", page.getByRole("link", { name: "Review" }));
  await trackedExpectVisible(
    diagnostics,
    `confirm review queue shows AI card ${expectedFrontText}`,
    page.getByText(expectedFrontText, { exact: true }),
    localUiTimeoutMs,
  );
}

async function assertLinkedAccountStatus(
  page: Page,
  email: string,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open settings navigation for account verification", page.getByRole("link", { name: "Settings" }));
  await trackedExpectVisible(
    diagnostics,
    `confirm settings shows workspace ${workspaceName}`,
    page.getByText(workspaceName, { exact: true }),
    localUiTimeoutMs,
  );
  await trackedClick(diagnostics, "open account settings screen", page.getByRole("link", { name: "Account Settings" }));
  await trackedClick(diagnostics, "open account status screen", page.getByRole("link", { name: "Account Status" }));
  await trackedExpectVisible(
    diagnostics,
    `confirm account status shows ${email}`,
    page.getByText(email, { exact: true }),
    externalUiTimeoutMs,
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm account status shows Linked",
    page.getByText("Linked", { exact: true }),
    externalUiTimeoutMs,
  );
}

async function deleteEphemeralWorkspace(
  page: Page,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedExpectVisible(
    diagnostics,
    "confirm settings tabs are visible before cleanup",
    page.getByRole("navigation", { name: "Settings tabs" }),
    localUiTimeoutMs,
  );

  const overviewHeading = page.getByRole("heading", { name: "Overview" });
  const startsOnOverview = await trackedIsVisible(
    diagnostics,
    "check whether cleanup already starts on workspace overview",
    overviewHeading,
  );

  if (startsOnOverview === false) {
    await trackedClick(
      diagnostics,
      "open workspace tab from settings shell",
      page.getByRole("link", { name: "Workspace", exact: true }),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace settings screen is visible",
      page.getByRole("heading", { name: "Workspace Settings" }),
      localUiTimeoutMs,
    );
    await trackedClick(diagnostics, "open workspace overview screen", page.getByRole("link", { name: "Overview" }));
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace overview screen is visible",
      overviewHeading,
      localUiTimeoutMs,
    );
  }

  await trackedClick(diagnostics, "open delete workspace dialog", page.getByRole("button", { name: "Delete workspace" }));
  await trackedClick(diagnostics, "continue into delete workspace confirmation dialog", page.getByRole("button", { name: "Continue" }));

  const confirmationInput = page.getByLabel("Type the phrase exactly to continue.");
  const confirmationPhraseLabel = page.getByLabel("confirmation phrase");
  const confirmationPhrase = await trackedReadRequiredTextContent(
    diagnostics,
    "read delete workspace confirmation phrase",
    confirmationPhraseLabel,
    externalUiTimeoutMs,
  );

  await trackedFill(
    diagnostics,
    `fill delete workspace confirmation phrase ${confirmationPhrase}`,
    confirmationInput,
    confirmationPhrase,
  );
  await trackedClick(
    diagnostics,
    `submit delete workspace confirmation for ${workspaceName}`,
    page.getByRole("dialog").getByRole("button", { name: "Delete workspace" }),
  );
  await trackedExpectNotText(
    diagnostics,
    `confirm topbar no longer shows workspace ${workspaceName}`,
    page.locator(".topbar-workspace"),
    workspaceName,
    externalUiTimeoutMs,
  );
}

async function trackedGoto(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  url: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  });
}

async function trackedReload(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  });
}

async function trackedWaitForUrl(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  urlPattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await page.waitForURL(urlPattern, { timeout: timeoutMs });
  });
}

async function trackedClick(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await locator.click();
  });
}

async function trackedFill(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  value: string,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await locator.fill(value);
  });
}

async function trackedPress(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  key: string,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await page.keyboard.press(key);
  });
}

async function trackedIsVisible(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
): Promise<boolean> {
  return diagnostics.runAction(actionName, async () => locator.isVisible());
}

async function trackedExpectVisible(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect(locator).toBeVisible({ timeout: timeoutMs });
  });
}

async function trackedExpectText(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  expectedText: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect(locator).toHaveText(expectedText, { timeout: timeoutMs });
  });
}

async function trackedExpectNotText(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  expectedText: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect(locator).not.toHaveText(expectedText, { timeout: timeoutMs });
  });
}

async function trackedReadRequiredTextContent(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  timeoutMs: number,
): Promise<string> {
  return diagnostics.runAction(actionName, async () => {
    await expect(locator).toBeVisible({ timeout: timeoutMs });
    const textContent = await locator.textContent();
    if (textContent === null || textContent.trim() === "") {
      throw new Error("Required text content is missing");
    }

    return textContent.trim();
  });
}

async function attachPageSnapshot(
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

function readPageUrl(page: Page, lastKnownUrl: string): string {
  if (page.isClosed()) {
    return lastKnownUrl;
  }

  const currentUrl = page.url();
  return currentUrl === "" ? lastKnownUrl : currentUrl;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

  return [
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
    const responseBits = [
      event.status === null ? null : `status=${String(event.status)}`,
      event.statusText === null ? null : `statusText=${event.statusText}`,
      event.ok === null ? null : `ok=${String(event.ok)}`,
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
    `currentUrl: ${snapshotState.currentUrl}`,
    `currentStep: ${snapshotState.currentStep ?? "unknown"}`,
    `currentStepStartedAt: ${snapshotState.currentStepStartedAt ?? "unknown"}`,
    `currentAction: ${snapshotState.currentAction ?? "none"}`,
    `currentActionStartedAt: ${snapshotState.currentActionStartedAt ?? "unknown"}`,
    `lastCompletedAction: ${snapshotState.lastCompletedAction ?? "none"}`,
    `lastCompletedActionAt: ${snapshotState.lastCompletedActionAt ?? "unknown"}`,
  ].join("\n");
}

function formatConsoleLocation(message: ConsoleMessage): string | null {
  const location = message.location();
  if (location.url === "" && location.lineNumber === 0 && location.columnNumber === 0) {
    return null;
  }

  return `${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
