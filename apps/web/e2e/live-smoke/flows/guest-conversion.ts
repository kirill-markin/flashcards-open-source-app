import { expect, type Page } from "@playwright/test";
import { trackedClick, trackedFill, trackedGoto } from "../../live-smoke.actions";
import { createLiveSmokeDiagnostics } from "../../live-smoke.diagnostics";
import { buildWorkspaceRoute, cardsRoute, reviewRoute } from "../../../src/routes";
import { databaseName } from "../../../src/localDb/core/databaseSchema";
import type { BrowserGuestOwner, BrowserGuestStoredState } from "../../../src/appData/session/guest/browserGuestStorage";
import type { BrowserGuestUpgradeResult } from "../../../src/apiContracts/guestAuth";
import { externalUiTimeoutMs, liveSmokeBrowserLocale, reviewPostSubmitTimeoutMs } from "../config";
import type { LiveSmokeSession } from "../types";

type GuestSnapshot = Readonly<{
  cards: ReadonlyArray<Readonly<{ cardId: string; deletedAt: string | null; tags: ReadonlyArray<string>; reps: number }>>;
  reviewIds: ReadonlyArray<string>;
  outboxCount: number;
}>;

async function guestOwner(page: Page): Promise<BrowserGuestOwner> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("flashcards-browser-guest-owner");
    if (raw === null) throw new Error("Guest smoke ownership is unavailable");
    const saved = JSON.parse(raw) as BrowserGuestStoredState;
    if (saved.status !== "owned") throw new Error("Guest smoke ownership is not installed");
    return saved.owner;
  });
}

async function snapshot(page: Page): Promise<GuestSnapshot> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Guest smoke database could not be opened"));
    });
    try {
      const read = <T,>(store: string): Promise<ReadonlyArray<T>> => new Promise((resolve, reject) => {
        const request = database.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as ReadonlyArray<T>);
        request.onerror = () => reject(new Error("Guest smoke database read failed"));
      });
      const [cards, reviews, outbox] = await Promise.all([
        read<{ cardId: string; deletedAt: string | null; tags: ReadonlyArray<string>; reps: number }>("cards"),
        read<{ reviewEventId: string }>("reviewEvents"), read<{ operationId: string }>("outbox"),
      ]);
      return { cards: cards.map(({ cardId, deletedAt, tags, reps }) => ({ cardId, deletedAt, tags, reps })),
        reviewIds: reviews.map((review) => review.reviewEventId), outboxCount: outbox.length };
    } finally { database.close(); }
  }, databaseName);
}

async function reviewGuestDemo(session: LiveSmokeSession): Promise<Readonly<{ workspaceId: string; demoId: string }>> {
  const { page, diagnostics, baseUrl } = session;
  await trackedGoto(page, diagnostics, "open the app as a fresh guest", baseUrl, externalUiTimeoutMs);
  await expect(page.getByTestId("guest-sign-in")).toBeVisible({ timeout: externalUiTimeoutMs });
  const workspaceId = await page.getByTestId("topbar-active-workspace").getAttribute("data-workspace-id");
  if (!workspaceId) throw new Error("Guest workspace id is unavailable");
  await expect.poll(async () => (await snapshot(page)).cards.length, { timeout: externalUiTimeoutMs }).toBe(1);
  const demoId = (await snapshot(page)).cards[0]!.cardId;
  await diagnostics.runAction("reveal the guest demo with Space without submitting a rating", async () => {
    const reviewPane = page.getByTestId("review-pane");
    await expect(page.getByTestId("review-reveal-answer")).toBeVisible();
    await page.getByTestId("review-current-front-card").locator(".review-front").click();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("review-rate-good")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(reviewPane).toHaveAttribute("data-review-current-card-id", demoId);
    await expect(reviewPane).toHaveAttribute("data-review-submit-state", "idle");
  });
  await trackedClick(diagnostics, "review the guest demo", page.getByTestId("review-rate-good"));
  await diagnostics.runAction("confirm the guest demo review finishes saving before navigation", async () => {
    const reviewPane = page.getByTestId("review-pane");
    await expect.poll(async () => ({
      submitState: await reviewPane.getAttribute("data-review-submit-state"),
      cardId: await reviewPane.getAttribute("data-review-last-submitted-card-id"),
      rating: await reviewPane.getAttribute("data-review-last-submitted-rating"),
    }), { timeout: reviewPostSubmitTimeoutMs }).toEqual({
      submitState: "settled",
      cardId: demoId,
      rating: "2",
    });
    expect((await snapshot(page)).cards.find((card) => card.cardId === demoId)?.reps).toBe(1);
  });
  await expect.poll(async () => (await snapshot(page)).reviewIds.length, { timeout: externalUiTimeoutMs }).toBe(1);
  await diagnostics.runAction("drain the guest demo review outbox before navigation", async () => {
    await expect.poll(async () => (await snapshot(page)).outboxCount, { timeout: externalUiTimeoutMs }).toBe(0);
  });
  return { workspaceId, demoId };
}

async function createGuestCard(session: LiveSmokeSession): Promise<Readonly<{ workspaceId: string; demoId: string; cardId: string }>> {
  const { page, diagnostics, baseUrl } = session;
  const { workspaceId, demoId } = await reviewGuestDemo(session);
  await trackedGoto(page, diagnostics, "open guest cards", baseUrl + buildWorkspaceRoute(workspaceId, cardsRoute), externalUiTimeoutMs);
  await trackedClick(diagnostics, "create a real guest card", page.getByTestId("cards-new-card"));
  await trackedFill(diagnostics, "enter the guest card question", page.getByTestId("card-form-front-text"), "Guest smoke question");
  await trackedFill(diagnostics, "enter the guest card answer", page.getByTestId("card-form-back-text"), "Guest smoke answer");
  await trackedClick(diagnostics, "save the guest card", page.getByTestId("card-form-save"));
  await expect.poll(async () => (await snapshot(page)).cards.length, { timeout: externalUiTimeoutMs }).toBe(2);
  const cardId = (await snapshot(page)).cards.find((card) => card.cardId !== demoId)!.cardId;
  await expect.poll(async () => (await snapshot(page)).outboxCount, { timeout: externalUiTimeoutMs }).toBe(0);
  return { workspaceId, demoId, cardId };
}

async function authenticateGuest(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics } = session;
  await trackedClick(diagnostics, "begin optional guest sign-in after draining writes", page.getByTestId("guest-sign-in"));
  await trackedClick(diagnostics, "choose email sign-in", page.locator("#signin-email"));
  await trackedFill(diagnostics, "enter the configured review account", page.locator('input[type="email"]').first(), session.reviewEmail);
  await trackedClick(diagnostics, "submit the configured review account", page.locator("#send-btn"));
  await expect(page.getByTestId("guest-destinations").or(page.getByTestId("guest-conversion-error")).or(page.locator("nav.nav"))).toBeVisible({ timeout: externalUiTimeoutMs });
}

async function waitForRegisteredDestination(page: Page): Promise<void> {
  await expect(page.getByTestId("guest-conversion")).toHaveCount(0, { timeout: externalUiTimeoutMs });
  await expect(page.locator("nav.nav")).toBeVisible({ timeout: externalUiTimeoutMs });
  await expect(page.getByTestId("guest-sign-in")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("flashcards-browser-guest-owner")),
    { timeout: externalUiTimeoutMs }).toBeNull();
}

export async function runGuestConversionFlow(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, baseUrl } = session;
  const guest = await createGuestCard(session);
  const before = await snapshot(page);
  await diagnostics.runAction("reload the guest without losing cards or reviews", async () => { await page.reload(); });
  await expect(page.getByTestId("guest-sign-in")).toBeVisible({ timeout: externalUiTimeoutMs });
  expect((await snapshot(page)).cards.map((card) => card.cardId).sort()).toEqual(before.cards.map((card) => card.cardId).sort());
  await expect.poll(async () => (await snapshot(page)).reviewIds, { timeout: externalUiTimeoutMs }).toEqual(before.reviewIds);
  const originalOwner = await guestOwner(page);
  expect(originalOwner.workspaceId).toBe(guest.workspaceId);
  expect(originalOwner.initialSeedAllowed).toBe(false);
  expect(originalOwner.pending).toBeNull();
  await diagnostics.runAction("remove only IndexedDB while retaining guest ownership and a stale reauth marker", async () => {
    const resetUrl = baseUrl + "/__e2e_guest_cache_reset";
    await page.route(resetUrl, async (route) => { await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Cache reset</title>" }); });
    try {
      await page.goto(resetUrl);
      await page.evaluate(async (name) => {
        localStorage.setItem("flashcards-browser-reauth-required", "1");
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error("Could not clear the guest cache"));
          request.onblocked = () => reject(new Error("Guest cache deletion is blocked"));
        });
      }, databaseName);
      expect(await page.evaluate(() => localStorage.getItem("flashcards-browser-reauth-required"))).toBe("1");
      expect(await guestOwner(page)).toEqual(originalOwner);
    } finally { await page.unroute(resetUrl); }
    await page.goto(baseUrl);
  });
  await expect(page.getByTestId("guest-sign-in")).toBeVisible({ timeout: externalUiTimeoutMs });
  await expect(page.getByTestId("topbar-active-workspace")).toHaveAttribute("data-workspace-id", guest.workspaceId);
  await expect.poll(async () => (await snapshot(page)).cards.map((card) => card.cardId).sort(),
    { timeout: externalUiTimeoutMs }).toEqual(before.cards.map((card) => card.cardId).sort());
  await expect.poll(async () => (await snapshot(page)).reviewIds, { timeout: externalUiTimeoutMs }).toEqual(before.reviewIds);
  expect(await guestOwner(page)).toEqual(originalOwner);
  expect(await page.evaluate(() => localStorage.getItem("flashcards-browser-reauth-required"))).toBeNull();

  await authenticateGuest(session);
  if (await page.getByTestId("guest-destinations").isVisible()) {
    await trackedClick(diagnostics, "open the new destination workspace form", page.getByTestId("guest-create-workspace"));
    await trackedFill(diagnostics, "name the new destination workspace", page.getByTestId("guest-create-workspace-name-input"), "Guest smoke workspace");
    await trackedClick(diagnostics, "keep the demo by creating a new destination workspace", page.getByTestId("guest-create-workspace-submit"));
  }
  await waitForRegisteredDestination(page);
  const destinationId = await page.getByTestId("topbar-active-workspace").getAttribute("data-workspace-id");
  if (!destinationId) throw new Error("Converted workspace id is unavailable");
  session.ownedWorkspaceId = destinationId;
  session.cleanupRequested = true;
  expect((await snapshot(page)).cards.find((card) => card.cardId === guest.demoId)?.deletedAt).toBeNull();
  expect((await snapshot(page)).cards.some((card) => card.cardId === guest.cardId)).toBe(true);
  expect((await snapshot(page)).reviewIds).toEqual(before.reviewIds);
  let registeredBefore = await snapshot(page);

  const browser = session.context.browser();
  if (browser === null) throw new Error("Guest smoke requires a browser context");
  for (const resume of [false, true]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: liveSmokeBrowserLocale });
    await context.addInitScript(() => { localStorage.setItem("flashcards-analytics-enabled", "granted"); });
    const guestPage = await context.newPage();
    const guestSession: LiveSmokeSession = { ...session, context, page: guestPage, diagnostics: createLiveSmokeDiagnostics(guestPage) };
    try {
      const merging = await createGuestCard(guestSession);
      await authenticateGuest(guestSession);
      if (resume) {
        await guestPage.route("**/guest-auth/browser/upgrade/complete", async (route) => {
          await route.fetch();
          await route.abort("failed");
        });
      }
      await trackedClick(guestSession.diagnostics, "merge guest work into the owned existing workspace",
        guestPage.locator(`[data-testid="guest-destination"][data-workspace-id="${destinationId}"]`));
      if (resume) {
        await expect(guestPage.getByTestId("guest-conversion-error")).toBeVisible({ timeout: externalUiTimeoutMs });
        await guestPage.unroute("**/guest-auth/browser/upgrade/complete");
        await guestPage.reload();
      }
      await waitForRegisteredDestination(guestPage);
      await expect(guestPage.getByTestId("topbar-active-workspace")).toHaveAttribute("data-workspace-id", destinationId);
      const merged = await snapshot(guestPage);
      expect(merged.cards.find((card) => card.cardId === merging.cardId)?.deletedAt).toBeNull();
      expect(merged.cards.find((card) => card.cardId === merging.demoId)?.deletedAt === null).toBe(resume);
      expect(merged.cards.find((card) => card.cardId === guest.demoId)?.deletedAt).toBeNull();
      expect(merged.cards.find((card) => card.cardId === merging.demoId)?.reps).toBe(1);
      expect(merged.reviewIds.length).toBe(resume ? 3 : 2);
      registeredBefore = merged;
    } finally { await context.close(); }
  }
  for (const recovery of ["none", "retry", "reload"] as const) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: liveSmokeBrowserLocale });
    await context.addInitScript(() => {
      localStorage.setItem("flashcards-analytics-enabled", "granted");
      new MutationObserver((mutations) => {
        if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof Element
          && (node.matches('[data-testid="guest-destinations"]') || node.querySelector('[data-testid="guest-destinations"]') !== null)))) {
          document.documentElement.dataset.guestTransferChooserSeen = "true";
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const guestPage = await context.newPage();
    const guestSession: LiveSmokeSession = { ...session, context, page: guestPage, diagnostics: createLiveSmokeDiagnostics(guestPage) };
    try {
      const demoOnly = await reviewGuestDemo(guestSession);
      const demoBefore = await snapshot(guestPage);
      expect(demoBefore.cards.map((card) => card.cardId)).toEqual([demoOnly.demoId]);
      expect(demoBefore.reviewIds).toHaveLength(1);
      const selection = { type: "existing", workspaceId: destinationId, discardDemoOnly: true };
      let loseCompletion = recovery !== "none";
      let completionCount = 0;
      await guestPage.route("**/guest-auth/browser/upgrade/complete", async (route) => {
        const pending = (await guestOwner(guestPage)).pending;
        expect(pending?.phase).toBe("completing");
        expect(pending?.selection).toEqual(selection);
        expect(pending?.destinationUserId).not.toBeNull();
        expect(route.request().postDataJSON()).toEqual({
          selection, guestWorkspaceSyncedAndOutboxDrained: true, supportsDroppedEntities: true,
        });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const result = await response.json() as BrowserGuestUpgradeResult;
        expect(result.workspace.workspaceId).toBe(destinationId);
        expect(result.droppedEntities?.cardIds).toEqual([demoOnly.demoId]);
        expect(result.droppedEntities?.reviewEventIds.slice().sort()).toEqual(demoBefore.reviewIds.slice().sort());
        completionCount += 1;
        if (loseCompletion) await route.abort("failed");
        else await route.fulfill({ response });
      });
      await authenticateGuest(guestSession);
      await expect(guestPage.getByTestId("guest-destinations")).toHaveCount(0);
      expect(await guestPage.evaluate(() => document.documentElement.dataset.guestTransferChooserSeen)).toBeUndefined();
      if (recovery !== "none") {
        await expect(guestPage.getByTestId("guest-conversion-error")).toBeVisible({ timeout: externalUiTimeoutMs });
        expect((await guestOwner(guestPage)).pending?.selection).toEqual(selection);
        loseCompletion = false;
        if (recovery === "retry") {
          await trackedClick(guestSession.diagnostics, "retry the committed demo-only completion with its saved selection",
            guestPage.getByTestId("guest-conversion-retry"));
        } else {
          await guestSession.diagnostics.runAction("reload after losing the committed demo-only completion", async () => { await guestPage.reload(); });
        }
      }
      await waitForRegisteredDestination(guestPage);
      expect(completionCount).toBeGreaterThanOrEqual(recovery === "none" ? 1 : 2);
      await expect(guestPage.getByTestId("topbar-active-workspace")).toHaveAttribute("data-workspace-id", destinationId);
      expect(await guestPage.evaluate(() => document.documentElement.dataset.guestTransferChooserSeen)).toBeUndefined();
      const completed = await snapshot(guestPage);
      expect(completed.cards.slice().sort((left, right) => left.cardId.localeCompare(right.cardId)))
        .toEqual(registeredBefore.cards.slice().sort((left, right) => left.cardId.localeCompare(right.cardId)));
      expect(completed.reviewIds.slice().sort()).toEqual(registeredBefore.reviewIds.slice().sort());
      expect(completed.outboxCount).toBe(0);
      await guestSession.diagnostics.runAction("reload the registered account after demo disposal", async () => { await guestPage.reload(); });
      await waitForRegisteredDestination(guestPage);
      expect((await snapshot(guestPage)).cards.some((card) => card.cardId === demoOnly.demoId)).toBe(false);
      expect((await snapshot(guestPage)).reviewIds.some((id) => demoBefore.reviewIds.includes(id))).toBe(false);
    } finally { await context.close(); }
  }
  await trackedGoto(page, diagnostics, "return to the converted workspace", baseUrl + buildWorkspaceRoute(destinationId, reviewRoute), externalUiTimeoutMs);
}
