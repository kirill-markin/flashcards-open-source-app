import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  observeDeleteWorkspaceDialogState,
  trackedClick,
  trackedExpectNotText,
  trackedExpectText,
  trackedExpectVisible,
  trackedFill,
  trackedGoto,
  trackedIsVisible,
  trackedReadRequiredTextContent,
  trackedWaitForComposerReady,
  trackedWaitForDeleteWorkspaceConfirmationState,
  trackedWaitForDeleteWorkspaceRetryTransition,
  trackedWaitForUrl,
} from "./live-smoke.actions";
import {
  attachPageSnapshot,
  createLiveSmokeDiagnostics,
  normalizeError,
  type LiveSmokeDiagnostics,
} from "./live-smoke.diagnostics";

const localUiTimeoutMs = 10_000;
const externalUiTimeoutMs = 30_000;

const reviewEmail = process.env.FLASHCARDS_LIVE_REVIEW_EMAIL ?? "google-review@example.com";
const authBaseUrl = process.env.FLASHCARDS_E2E_AUTH_BASE_URL ?? "https://auth.flashcards-open-source-app.com";

type LiveSmokeScenario = Readonly<{
  workspaceName: string;
  manualFrontText: string;
  manualBackText: string;
}>;

type CompletedSqlToolCall = Readonly<{
  summary: string;
  request: string | null;
  response: string | null;
}>;

/**
 * This smoke suite intentionally keeps one connected browser session and one
 * isolated linked workspace, but splits the coverage into a few grouped tests.
 * The groups share state on purpose so the web release gate stays close to the
 * existing flow while making failures easier to attribute.
 */
test.describe.serial("live smoke flow uses the real demo account across review, cards, AI, and settings", () => {
  let sharedContext: BrowserContext | null = null;
  let sharedPage: Page | null = null;
  let sharedDiagnostics: LiveSmokeDiagnostics | null = null;
  let sharedBaseUrl: string | null = null;
  let sharedScenario: LiveSmokeScenario | null = null;
  let shouldDeleteWorkspace = false;

  test.beforeAll(async ({ browser, baseURL }) => {
    if (baseURL === undefined) {
      throw new Error("Playwright baseURL is required for the live smoke flow");
    }

    sharedBaseUrl = baseURL;
    sharedScenario = buildScenario(runIdFromClock());
    sharedContext = await createSharedLiveSmokeContext(browser);
    sharedPage = await sharedContext.newPage();
    sharedDiagnostics = createLiveSmokeDiagnostics(sharedPage);
  });

  test.afterAll(async () => {
    const cleanupInfo = test.info();

    try {
      if (shouldDeleteWorkspace && sharedPage !== null && sharedDiagnostics !== null && sharedScenario !== null) {
        sharedDiagnostics.startTest(`${cleanupInfo.title} cleanup`);
        await runTrackedTestStep(sharedDiagnostics, "delete the isolated workspace", async () => {
          await deleteEphemeralWorkspace(sharedPage, sharedScenario.workspaceName, sharedDiagnostics);
        });
      }
    } catch (error) {
      const cleanupError = normalizeError(error);

      if (sharedPage !== null && sharedDiagnostics !== null) {
        await sharedDiagnostics.attachFailureDetails(cleanupInfo, cleanupError);
        await attachPageSnapshot(sharedPage, cleanupInfo, "cleanup-failure-page", sharedDiagnostics);
      }

      throw cleanupError;
    } finally {
      if (sharedPage !== null && sharedDiagnostics !== null) {
        await attachPageSnapshot(sharedPage, cleanupInfo, "final-page", sharedDiagnostics);
      }

      if (sharedPage !== null && sharedPage.isClosed() === false) {
        await sharedPage.close();
      }

      if (sharedContext !== null) {
        await sharedContext.close();
      }
    }
  });

  test("linked workspace shows account status and workspace state", async ({ page: _page }, testInfo) => {
    await runLiveSmokeGroupTest(
      testInfo,
      async () => {
        const page = requireSharedPage(sharedPage);
        const diagnostics = requireSharedDiagnostics(sharedDiagnostics);
        const appBaseUrl = requireSharedBaseUrl(sharedBaseUrl);
        const scenario = requireSharedScenario(sharedScenario);

        await runTrackedTestStep(diagnostics, "sign in with the configured review account", async () => {
          await signInWithReviewAccount(page, appBaseUrl, reviewEmail, diagnostics);
        });

        await runTrackedTestStep(diagnostics, "create an isolated linked workspace for this run", async () => {
          await createEphemeralWorkspace(page, scenario.workspaceName, diagnostics);
          shouldDeleteWorkspace = true;
        });

        await runTrackedTestStep(diagnostics, "verify linked account status and workspace state", async () => {
          await assertLinkedAccountStatus(page, reviewEmail, scenario.workspaceName, diagnostics);
        });
      },
      sharedPage,
      sharedDiagnostics,
    );
  });

  test("manual card can be created and reviewed in the linked workspace", async ({ page: _page }, testInfo) => {
    await runLiveSmokeGroupTest(
      testInfo,
      async () => {
        const page = requireSharedPage(sharedPage);
        const diagnostics = requireSharedDiagnostics(sharedDiagnostics);
        const scenario = requireSharedScenario(sharedScenario);

        await runTrackedTestStep(diagnostics, "create one manual card", async () => {
          await createManualCard(page, scenario.manualFrontText, scenario.manualBackText, diagnostics);
        });

        await runTrackedTestStep(diagnostics, "verify the manual card in cards and review it", async () => {
          await assertCardVisibleInCards(page, scenario.manualFrontText, diagnostics, localUiTimeoutMs);
          await reviewCardFromQueue(page, scenario.manualFrontText, diagnostics);
        });
      },
      sharedPage,
      sharedDiagnostics,
    );
  });

  test("ai card can be created with explicit confirmation and complete one insert", async ({ page: _page }, testInfo) => {
    await runLiveSmokeGroupTest(
      testInfo,
      async () => {
        const page = requireSharedPage(sharedPage);
        const diagnostics = requireSharedDiagnostics(sharedDiagnostics);

        await runTrackedTestStep(diagnostics, "create one AI card with explicit confirmation and confirm the insert completed", async () => {
          await runAiCardCreationWithConfirmation(page, diagnostics);
        });
      },
      sharedPage,
      sharedDiagnostics,
    );
  });

  test("new chat resets the AI conversation cleanly", async ({ page: _page }, testInfo) => {
    await runLiveSmokeGroupTest(
      testInfo,
      async () => {
        const page = requireSharedPage(sharedPage);
        const diagnostics = requireSharedDiagnostics(sharedDiagnostics);

        await runTrackedTestStep(diagnostics, "start a new chat and confirm the conversation resets cleanly", async () => {
          await assertNewChatResetsConversation(page, diagnostics);
        });
      },
      sharedPage,
      sharedDiagnostics,
    );
  });
});

function runIdFromClock(): string {
  return `${Date.now()}`;
}

async function createSharedLiveSmokeContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
  });
}

function requireSharedPage(page: Page | null): Page {
  if (page === null) {
    throw new Error("Shared live smoke page is unavailable");
  }

  return page;
}

function requireSharedDiagnostics(diagnostics: LiveSmokeDiagnostics | null): LiveSmokeDiagnostics {
  if (diagnostics === null) {
    throw new Error("Shared live smoke diagnostics are unavailable");
  }

  return diagnostics;
}

function requireSharedBaseUrl(baseURL: string | null): string {
  if (baseURL === null) {
    throw new Error("Shared live smoke baseURL is unavailable");
  }

  return baseURL;
}

function requireSharedScenario(scenario: LiveSmokeScenario | null): LiveSmokeScenario {
  if (scenario === null) {
    throw new Error("Shared live smoke scenario is unavailable");
  }

  return scenario;
}

async function runLiveSmokeGroupTest(
  testInfo: TestInfo,
  body: () => Promise<void>,
  page: Page | null,
  diagnostics: LiveSmokeDiagnostics | null,
): Promise<void> {
  if (diagnostics !== null) {
    diagnostics.startTest(testInfo.title);
  }

  try {
    await body();
  } catch (error) {
    const primaryFailure = normalizeError(error);

    if (diagnostics !== null) {
      await diagnostics.attachFailureDetails(testInfo, primaryFailure);
    }

    if (page !== null && diagnostics !== null) {
      await attachPageSnapshot(page, testInfo, "failure-page", diagnostics);
    }

    throw error;
  } finally {
    if (page !== null && diagnostics !== null) {
      await attachPageSnapshot(page, testInfo, "group-final-page", diagnostics);
    }
  }
}

function buildScenario(runId: string): LiveSmokeScenario {
  return {
    workspaceName: `E2E web ${runId}`,
    manualFrontText: `Manual e2e web ${runId}`,
    manualBackText: `Manual answer e2e web ${runId}`,
  };
}

function buildLoginUrl(appBaseUrl: string): string {
  const redirectUri = `${appBaseUrl}/review`;
  return `${authBaseUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
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
    page.getByRole("link", { name: "Review", exact: true }),
    localUiTimeoutMs,
  );
}

async function createEphemeralWorkspace(
  page: Page,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open settings navigation", page.getByRole("link", { name: "Settings", exact: true }));
  await trackedClick(
    diagnostics,
    "open current workspace settings",
    page.getByRole("navigation", { name: "Settings tabs" }).getByRole("link", { name: "Current Workspace", exact: true }),
  );
  await trackedClick(diagnostics, "expand workspace picker card", page.getByRole("button", { name: "Workspace" }));
  await trackedClick(
    diagnostics,
    "open new workspace form",
    page.locator(".settings-workspace-picker").getByRole("button", { name: "New Workspace", exact: true }),
  );
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
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open cards navigation", page.getByRole("link", { name: "Cards", exact: true }));
  await trackedClick(diagnostics, "open new card screen", page.getByRole("link", { name: "New card", exact: true }));
  await trackedFill(diagnostics, `fill card front text ${frontText}`, page.getByLabel("Front"), frontText);
  await trackedFill(diagnostics, `fill card back text ${backText}`, page.getByLabel("Back"), backText);
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
  timeoutMs: number,
): Promise<void> {
  await trackedClick(diagnostics, "open cards navigation for verification", page.getByRole("link", { name: "Cards", exact: true }));
  const searchInput = page.getByPlaceholder("Search front, back, or tags");
  await trackedFill(diagnostics, "clear cards search input", searchInput, "");
  await trackedFill(diagnostics, `fill cards search input with ${searchText}`, searchInput, searchText);
  await diagnostics.runAction(`confirm cards list shows ${searchText}`, async () => {
    const expectedCard = page.getByText(searchText, { exact: true });
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        if (await expectedCard.isVisible().catch(() => false)) {
          return "visible";
        }

        const syncStatusCount = await syncStatus.count();
        if (syncStatusCount > 0) {
          const syncText = await syncStatus.first().innerText();
          if (syncText.trim() === "Syncing...") {
            return "syncing";
          }
        }

        return "missing";
      },
      { timeout: timeoutMs },
    ).toBe("visible");
  });
}

async function reviewCardFromQueue(
  page: Page,
  expectedFrontText: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open review navigation", page.getByRole("link", { name: "Review", exact: true }));
  await trackedExpectVisible(
    diagnostics,
    `confirm review queue shows ${expectedFrontText}`,
    page.locator(".review-front").filter({ hasText: expectedFrontText }).first(),
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

async function runAiCardCreationWithConfirmation(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open AI chat navigation", page.getByRole("link", { name: "AI chat", exact: true }));
  await trackedWaitForUrl(
    page,
    diagnostics,
    "wait for AI chat route to become active",
    /\/chat$/,
    externalUiTimeoutMs,
  );
  const fullscreenChat = page.locator(".chat-sidebar-fullscreen");
  await trackedExpectVisible(
    diagnostics,
    "confirm fullscreen AI chat surface is visible",
    fullscreenChat,
    externalUiTimeoutMs,
  );
  const messageField = fullscreenChat.getByPlaceholder("Ask about cards, review history, or attach notes...");
  const sendButton = fullscreenChat.getByRole("button", { name: "Send message" });
  const createPrompt = "I give you all permissions. Please create one test flashcard now.";

  await waitForAiChatSendReadiness(page, diagnostics);

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
    await trackedClick(diagnostics, `send AI create prompt attempt ${String(attempt)}`, sendButton);

    await diagnostics.runAction(
      `confirm AI create prompt attempt ${String(attempt)} was accepted by the chat composer`,
      async () => {
        const timeoutAt = Date.now() + externalUiTimeoutMs;
        let runAcceptanceState: "waiting" | "running" | "queued" | "error" = "waiting";

        while (Date.now() < timeoutAt) {
          const assistantErrorCount = await page.locator(".chat-msg-error").count();
          if (assistantErrorCount > previousAssistantErrorCount) {
            runAcceptanceState = "error";
            break;
          }
          const stopButtonVisible = await page.getByRole("button", { name: "Stop response" }).isVisible().catch(() => false);
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
          throw new Error(`AI create prompt attempt ${String(attempt)} was not accepted before timeout.`);
        }

        if (runAcceptanceState === "error") {
          throw new Error(`AI create prompt attempt ${String(attempt)} reported an assistant error before the run was accepted.`);
        }
      },
    );
    await diagnostics.runAction(
      `wait for AI create prompt attempt ${String(attempt)} run to finish and return send action`,
      async () => {
        const timeoutAt = Date.now() + externalUiTimeoutMs;
        let runCompletionState: "running" | "idle" | "error" = "running";

        while (Date.now() < timeoutAt) {
          const assistantErrorCount = await page.locator(".chat-msg-error").count();
          if (assistantErrorCount > previousAssistantErrorCount) {
            runCompletionState = "error";
            break;
          }

          const sendVisible = await page.getByRole("button", { name: "Send message" }).isVisible().catch(() => false);
          if (sendVisible) {
            runCompletionState = "idle";
            break;
          }

          await page.waitForTimeout(250);
        }

        if (runCompletionState === "running") {
          throw new Error(`AI create prompt attempt ${String(attempt)} did not finish before timeout.`);
        }

        if (runCompletionState === "error") {
          throw new Error(`AI create prompt attempt ${String(attempt)} reported an assistant error before the run completed.`);
        }
      },
    );

    const matchedInsertToolCall = await diagnostics.runAction(
      `scan completed SQL tool calls for card insert after attempt ${String(attempt)}`,
      async () => findCompletedCardInsertToolCall(page),
    );

    if (matchedInsertToolCall !== null) {
      return;
    }
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

async function waitForAiChatSendReadiness(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await diagnostics.runAction("wait for AI chat sync gate to clear before send", async () => {
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        const syncText = await syncStatus.first().textContent().catch(() => null);
        if (syncText === null) {
          return "ready";
        }

        return syncText.trim() === "Syncing..." ? "syncing" : "ready";
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

async function findCompletedCardInsertToolCall(
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

async function readCompletedSqlToolCalls(page: Page): Promise<ReadonlyArray<CompletedSqlToolCall>> {
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

async function assertNewChatResetsConversation(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(
    diagnostics,
    "start a fresh AI chat from the top bar",
    page.locator(".chat-sidebar-fullscreen").getByRole("button", { name: "New", exact: true }),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm AI chat empty state is visible after starting a new chat",
    page.getByText("Try asking:", { exact: true }),
    externalUiTimeoutMs,
  );
  await diagnostics.runAction("confirm AI chat has no remaining messages or message-level errors", async () => {
    const allMessages = page.locator(".chat-msg");
    const errorMessages = page.locator(".chat-msg-error");
    await expect.poll(async () => allMessages.count(), { timeout: externalUiTimeoutMs }).toBe(0);
    await expect.poll(async () => errorMessages.count(), { timeout: externalUiTimeoutMs }).toBe(0);
  });
}

async function assertCardReachableInReview(
  page: Page,
  expectedFrontText: string,
  diagnostics: LiveSmokeDiagnostics,
  timeoutMs: number,
): Promise<void> {
  await trackedClick(diagnostics, "open review navigation for AI card verification", page.getByRole("link", { name: "Review", exact: true }));
  await diagnostics.runAction(`confirm review queue shows AI card ${expectedFrontText}`, async () => {
    const expectedCard = page.locator(".review-front").filter({ hasText: expectedFrontText }).first();
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        if (await expectedCard.isVisible().catch(() => false)) {
          return "visible";
        }

        const syncStatusCount = await syncStatus.count();
        if (syncStatusCount > 0) {
          const syncText = await syncStatus.first().innerText();
          if (syncText.trim() === "Syncing...") {
            return "syncing";
          }
        }

        return "missing";
      },
      { timeout: timeoutMs },
    ).toBe("visible");
  });
}

async function assertLinkedAccountStatus(
  page: Page,
  email: string,
  workspaceName: string,
  diagnostics: LiveSmokeDiagnostics,
): Promise<void> {
  await trackedClick(diagnostics, "open settings navigation for account verification", page.getByRole("link", { name: "Settings", exact: true }));
  await trackedExpectText(
    diagnostics,
    `confirm settings shows workspace ${workspaceName}`,
    page.locator(".topbar-workspace"),
    workspaceName,
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open account settings screen",
    page.getByRole("navigation", { name: "Settings tabs" }).getByRole("link", { name: "Account", exact: true }),
  );
  await trackedExpectVisible(
    diagnostics,
    "confirm account settings heading is visible",
    page.getByRole("heading", { name: "Account Settings" }),
    localUiTimeoutMs,
  );
  await trackedClick(
    diagnostics,
    "open account status screen",
    page.locator(".settings-nav-card").filter({ hasText: "Account Status" }).first(),
  );
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
  const settingsTabs = page.getByRole("navigation", { name: "Settings tabs" });
  const hasSettingsTabs = await trackedIsVisible(
    diagnostics,
    "check whether settings tabs are already visible before cleanup",
    settingsTabs,
  );

  if (hasSettingsTabs === false) {
    await trackedClick(
      diagnostics,
      "open settings navigation before cleanup",
      page.getByRole("link", { name: "Settings", exact: true }),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm settings tabs are visible before cleanup",
      settingsTabs,
      localUiTimeoutMs,
    );
  }

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
    await trackedClick(
      diagnostics,
      "open workspace overview screen",
      page.locator(".settings-nav-card").filter({ hasText: "Overview" }).first(),
    );
    await trackedExpectVisible(
      diagnostics,
      "confirm workspace overview screen is visible",
      overviewHeading,
      localUiTimeoutMs,
    );
  }

  await trackedClick(diagnostics, "open delete workspace dialog", page.getByRole("button", { name: "Delete workspace" }));
  const deleteDialog = page.getByRole("dialog", { name: "Delete workspace" });
  await trackedExpectVisible(
    diagnostics,
    "confirm delete workspace dialog is visible",
    deleteDialog,
    localUiTimeoutMs,
  );

  let deleteDialogState = await trackedWaitForDeleteWorkspaceConfirmationState(
    page,
    diagnostics,
    "wait for delete workspace details",
    deleteDialog,
    externalUiTimeoutMs,
  );

  if (deleteDialogState === "retry") {
    await trackedClick(
      diagnostics,
      "retry delete workspace details fetch",
      deleteDialog.getByRole("button", { name: "Retry" }),
    );
    await trackedWaitForDeleteWorkspaceRetryTransition(
      page,
      diagnostics,
      "wait for delete workspace dialog to transition after retry",
      deleteDialog,
      localUiTimeoutMs,
    );
    deleteDialogState = await trackedWaitForDeleteWorkspaceConfirmationState(
      page,
      diagnostics,
      "wait for delete workspace details after retry",
      deleteDialog,
      externalUiTimeoutMs,
    );
    if (deleteDialogState !== "confirmation") {
      const finalObservation = await observeDeleteWorkspaceDialogState(deleteDialog);
      throw new Error(
        "Delete workspace dialog stayed in retry state after retry "
        + `(state=${finalObservation.state}, loadingVisible=${finalObservation.isLoadingVisible}, `
        + `retryVisible=${finalObservation.isRetryVisible}, `
        + `confirmationPhraseVisible=${finalObservation.isConfirmationPhraseVisible}, `
        + `confirmationInputVisible=${finalObservation.isConfirmationInputVisible})`,
      );
    }
  }

  const confirmationInput = deleteDialog.getByLabel("Type the phrase exactly to continue.");
  const confirmationPhraseLabel = deleteDialog.getByLabel("confirmation phrase");
  const confirmationPhrase = await trackedReadRequiredTextContent(
    diagnostics,
    "read delete workspace confirmation phrase after details resolve",
    confirmationPhraseLabel,
    externalUiTimeoutMs,
  );

  await trackedFill(
    diagnostics,
    `enter delete workspace confirmation phrase ${confirmationPhrase}`,
    confirmationInput,
    confirmationPhrase,
  );
  await trackedClick(
    diagnostics,
    `submit workspace deletion for ${workspaceName}`,
    deleteDialog.getByRole("button", { name: "Delete workspace" }),
  );
  await trackedExpectNotText(
    diagnostics,
    `confirm topbar no longer shows workspace ${workspaceName}`,
    page.locator(".topbar-workspace"),
    workspaceName,
    externalUiTimeoutMs,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
