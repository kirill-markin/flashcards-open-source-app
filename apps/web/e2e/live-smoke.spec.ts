import { expect, test, type Page, type TestInfo } from "@playwright/test";

const liveUiTimeoutMs = 120_000;
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
  let primaryFailure: Error | null = null;

  try {
    await test.step("sign in with the configured review account", async () => {
      await signInWithReviewAccount(page, baseURL, reviewEmail);
    });

    await test.step("create an isolated linked workspace for this run", async () => {
      await createEphemeralWorkspace(page, scenario.workspaceName);
    });

    await test.step("create one manual card", async () => {
      await createManualCard(page, scenario.manualFrontText, scenario.manualBackText, scenario.markerTag);
    });

    await test.step("verify the manual card in cards and review it", async () => {
      await assertCardVisibleInCards(page, scenario.manualFrontText);
      await reviewCardFromQueue(page, scenario.manualFrontText);
    });

    await test.step("reload the browser and keep the linked session", async () => {
      await restartAndAssertLinkedSession(page, scenario.workspaceName);
    });

    await test.step("create one AI card with explicit confirmation", async () => {
      await runAiCardCreationWithConfirmation(page, scenario.aiFrontText, scenario.aiBackText, scenario.markerTag);
    });

    await test.step("verify the AI-created card is visible in cards and review", async () => {
      await assertCardVisibleInCards(page, scenario.aiFrontText);
      await assertCardReachableInReview(page, scenario.aiFrontText);
    });

    await test.step("verify linked account status and workspace state", async () => {
      await assertLinkedAccountStatus(page, reviewEmail, scenario.workspaceName);
    });
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    await attachPageSnapshot(page, testInfo, "final-page");

    try {
      await test.step("delete the isolated workspace", async () => {
        await deleteEphemeralWorkspace(page, scenario.workspaceName);
      });
    } catch (error) {
      const cleanupError = error instanceof Error ? error : new Error(String(error));
      await attachPageSnapshot(page, testInfo, "cleanup-failure-page");

      if (primaryFailure !== null) {
        await testInfo.attach("cleanup-failure.txt", {
          body: cleanupError.stack ?? cleanupError.message,
          contentType: "text/plain",
        });
      } else {
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

async function signInWithReviewAccount(page: Page, appBaseUrl: string, email: string): Promise<void> {
  await page.goto(buildLoginUrl(appBaseUrl), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForURL(new RegExp(`^${escapeRegExp(`${appBaseUrl}/review`)}`), { timeout: liveUiTimeoutMs });

  if (await page.getByRole("heading", { name: "Choose workspace" }).isVisible()) {
    await page.locator(".workspace-choice-btn").first().click();
  }

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: liveUiTimeoutMs });
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function createEphemeralWorkspace(page: Page, workspaceName: string): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Current Workspace" }).click();
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "New Workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create Workspace" }).click();
  await expect(page.locator(".topbar-workspace")).toHaveText(workspaceName, { timeout: liveUiTimeoutMs });
}

async function createManualCard(
  page: Page,
  frontText: string,
  backText: string,
  markerTag: string,
): Promise<void> {
  await page.getByRole("link", { name: "Cards" }).click();
  await page.getByRole("link", { name: "New card" }).click();
  await page.getByLabel("Front").fill(frontText);
  await page.getByLabel("Back").fill(backText);
  await page.getByText("Click to add tags").click();
  await page.getByPlaceholder("Type and press Enter").fill(markerTag);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "New card" }).click();
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByRole("heading", { name: "Cards" })).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function assertCardVisibleInCards(page: Page, searchText: string): Promise<void> {
  await page.getByRole("link", { name: "Cards" }).click();
  const searchInput = page.getByPlaceholder("Search front, back, or tags");
  await searchInput.fill("");
  await searchInput.fill(searchText);
  await expect(page.getByText(searchText, { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function reviewCardFromQueue(page: Page, expectedFrontText: string): Promise<void> {
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByText(expectedFrontText, { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();

  await expect.poll(
    async () => page.locator(".review-pane").innerText(),
    { timeout: liveUiTimeoutMs },
  ).not.toContain(expectedFrontText);
}

async function restartAndAssertLinkedSession(page: Page, workspaceName: string): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: liveUiTimeoutMs });
  await expect(page.locator(".topbar-workspace")).toHaveText(workspaceName, { timeout: liveUiTimeoutMs });
}

async function runAiCardCreationWithConfirmation(
  page: Page,
  aiFrontText: string,
  aiBackText: string,
  markerTag: string,
): Promise<void> {
  await page.getByRole("link", { name: "AI chat" }).click();
  const messageField = page.getByPlaceholder("Ask about cards, review history, or attach notes...");

  await messageField.fill(
    `Prepare exactly one flashcard proposal. Use front text "${aiFrontText}", back text "${aiBackText}", and include tag "${markerTag}". Wait for my confirmation before creating it.`,
  );
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText(aiFrontText, { exact: false })).toBeVisible({ timeout: liveUiTimeoutMs });

  await messageField.fill("Confirmed. Create the card exactly as proposed.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Done")).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function assertCardReachableInReview(page: Page, expectedFrontText: string): Promise<void> {
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByText(expectedFrontText, { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function assertLinkedAccountStatus(page: Page, email: string, workspaceName: string): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
  await page.getByRole("link", { name: "Account Settings" }).click();
  await page.getByRole("link", { name: "Account Status" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
  await expect(page.getByText("Linked", { exact: true })).toBeVisible({ timeout: liveUiTimeoutMs });
}

async function deleteEphemeralWorkspace(page: Page, workspaceName: string): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Workspace Settings" }).click();
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Delete workspace" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const confirmationPhrase = await page.getByLabel("confirmation phrase").textContent();
  if (confirmationPhrase === null || confirmationPhrase.trim() === "") {
    throw new Error("Workspace delete confirmation phrase is missing");
  }

  await page.getByLabel("Type the phrase exactly to continue.").fill(confirmationPhrase.trim());
  await page.getByRole("dialog").getByRole("button", { name: "Delete workspace" }).click();
  await expect(page.locator(".topbar-workspace")).not.toHaveText(workspaceName, { timeout: liveUiTimeoutMs });
}

async function attachPageSnapshot(page: Page, testInfo: TestInfo, fileNamePrefix: string): Promise<void> {
  const outputPath = testInfo.outputPath(`${fileNamePrefix}.html`);
  await testInfo.attach(`${fileNamePrefix}.html`, {
    body: await page.content(),
    contentType: "text/html",
  });
  await page.screenshot({
    path: testInfo.outputPath(`${fileNamePrefix}.png`),
    fullPage: true,
  });
  await page.evaluate(() => document.documentElement.outerHTML).then(async (html) => {
    await testInfo.attach(`${fileNamePrefix}-dom.html`, {
      body: html,
      contentType: "text/html",
    });
  });
  void outputPath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
