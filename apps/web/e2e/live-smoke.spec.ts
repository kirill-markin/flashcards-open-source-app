import { test } from "./live-smoke/fixture";
import { runAiCardCreationFlow, runAiConversationResetFlow } from "./live-smoke/flows/ai";
import { runLinkedWorkspaceSetupFlow } from "./live-smoke/flows/auth-workspace";
import { runSeededCardReviewFlow } from "./live-smoke/flows/cards-review";
import { runResetProgressFlow } from "./live-smoke/flows/reset-progress";
import { runWorkspaceCleanupFlow } from "./live-smoke/flows/settings-cleanup";
import {
  attachPageSnapshot,
  normalizeError,
} from "./live-smoke.diagnostics";

/**
 * This smoke suite intentionally keeps one connected browser session and one
 * isolated linked workspace, but splits the coverage into a few grouped tests.
 * The groups share state on purpose so the web release gate stays close to the
 * existing flow while making failures easier to attribute.
 */
test.describe.serial("live smoke flow uses the configured review account across the seeded linked workspace, review, cards, AI, and settings", () => {
  test.afterAll(async ({ liveSmokeSession }) => {
    const cleanupInfo = test.info();
    const { page, diagnostics } = liveSmokeSession;

    try {
      if (liveSmokeSession.cleanupRequested) {
        diagnostics.startTest(`${cleanupInfo.title} cleanup`);
        await runWorkspaceCleanupFlow(liveSmokeSession);
      }
    } catch (error) {
      const cleanupError = normalizeError(error);
      await diagnostics.attachFailureDetails(cleanupInfo, cleanupError);
      await attachPageSnapshot(page, cleanupInfo, "cleanup-failure-page", diagnostics);
      throw cleanupError;
    } finally {
      await attachPageSnapshot(page, cleanupInfo, "final-page", diagnostics);
    }
  });

  test("configured review account creates and seeds a linked workspace", async ({ liveSmokeSession }) => {
    await runLinkedWorkspaceSetupFlow(liveSmokeSession);
  });

  test("seeded linked-workspace card can be reviewed", async ({ liveSmokeSession }) => {
    await runSeededCardReviewFlow(liveSmokeSession);
  });

  test("resetting all progress makes the seeded card due again", async ({ liveSmokeSession }) => {
    await runResetProgressFlow(liveSmokeSession);
  });

  test("ai card can be created with explicit confirmation and complete one insert", async ({ liveSmokeSession }) => {
    await runAiCardCreationFlow(liveSmokeSession);
  });

  test("new chat resets the AI conversation cleanly", async ({ liveSmokeSession }) => {
    await runAiConversationResetFlow(liveSmokeSession);
  });
});
