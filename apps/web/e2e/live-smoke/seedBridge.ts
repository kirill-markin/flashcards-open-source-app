import { expect, type BrowserContext, type Page } from "@playwright/test";

import type {
  TestSeedRequest,
  TestSeedResult,
} from "../../src/appData/testSeedBridge";
import type { LiveSmokeDiagnostics } from "../live-smoke.diagnostics";
import { externalUiTimeoutMs } from "./config";

export async function enableTestSeedBridge(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.__FLASHCARDS_E2E__ = {
      ...window.__FLASHCARDS_E2E__,
      enableTestSeedBridge: true,
    };
  });
}

export async function seedLinkedWorkspaceForTest(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  request: TestSeedRequest,
  expectedWorkspaceName: string,
): Promise<TestSeedResult> {
  return diagnostics.runAction(`seed linked workspace through the appData test bridge for ${expectedWorkspaceName}`, async () => {
    await expect.poll(
      async () => page.evaluate(() => window.__FLASHCARDS_TEST_SEED_BRIDGE__?.workspaceName ?? null),
      { timeout: externalUiTimeoutMs },
    ).toBe(expectedWorkspaceName);

    const invocationResult = await page.evaluate(async ({
      seedRequest,
      workspaceName,
    }: {
      seedRequest: TestSeedRequest;
      workspaceName: string;
    }) => {
      const bridge = window.__FLASHCARDS_TEST_SEED_BRIDGE__;
      if (bridge === undefined) {
        throw new Error("AppData test seed bridge is unavailable");
      }

      if (bridge.workspaceName !== workspaceName) {
        throw new Error(
          `AppData test seed bridge is bound to an unexpected workspace: `
          + `expected ${workspaceName}, received ${bridge.workspaceName}`,
        );
      }

      return {
        bridgeWorkspaceId: bridge.workspaceId,
        bridgeWorkspaceName: bridge.workspaceName,
        seedResult: await bridge.seedLinkedWorkspace(seedRequest),
      };
    }, {
      seedRequest: request,
      workspaceName: expectedWorkspaceName,
    });

    if (invocationResult.seedResult.workspaceId !== invocationResult.bridgeWorkspaceId) {
      throw new Error(
        `AppData test seed bridge returned an unexpected workspace id: `
        + `expected ${invocationResult.bridgeWorkspaceId} (${invocationResult.bridgeWorkspaceName}), `
        + `received ${invocationResult.seedResult.workspaceId}`,
      );
    }

    return invocationResult.seedResult;
  });
}
