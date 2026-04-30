import { expect, type Locator, type Page } from "@playwright/test";

import type { LiveSmokeDiagnostics } from "./live-smoke.diagnostics";

type DeleteWorkspaceDialogState = "loading" | "retry" | "confirmation";

export type DeleteWorkspaceDialogObservation = Readonly<{
  state: DeleteWorkspaceDialogState;
  isLoadingVisible: boolean;
  isRetryVisible: boolean;
  isConfirmationPhraseVisible: boolean;
  isConfirmationInputVisible: boolean;
}>;

export async function trackedGoto(
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

export async function trackedWaitForUrl(
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

export async function trackedClick(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await locator.click();
  });
}

export async function trackedFill(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  value: string,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await locator.fill(value);
  });
}

export async function trackedPress(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  key: string,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await page.keyboard.press(key);
  });
}

export async function trackedIsVisible(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
): Promise<boolean> {
  return diagnostics.runAction(actionName, async () => locator.isVisible());
}

export async function trackedExpectVisible(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect(locator).toBeVisible({ timeout: timeoutMs });
  });
}

export async function trackedExpectAttribute(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  locator: Locator,
  attributeName: string,
  expectedValue: string,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect(locator).toHaveAttribute(attributeName, expectedValue, { timeout: timeoutMs });
  });
}

export async function trackedExpectText(
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

export async function trackedExpectNotText(
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

export async function trackedReadRequiredTextContent(
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

export async function trackedWaitForComposerReady(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  messageField: Locator,
  sendButton: Locator,
  expectedDraftText: string,
  timeoutMs: number,
): Promise<void> {
  await trackedWaitForComposerState(
    diagnostics,
    actionName,
    messageField,
    sendButton,
    expectedDraftText,
    true,
    timeoutMs,
  );
}

export async function trackedWaitForComposerState(
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  messageField: Locator,
  sendButton: Locator,
  expectedDraftText: string,
  expectedSendEnabled: boolean,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect.poll(
      async () => ({
        inputText: await messageField.inputValue(),
        isSendEnabled: await sendButton.isEnabled(),
      }),
      { timeout: timeoutMs },
    ).toEqual({
      inputText: expectedDraftText,
      isSendEnabled: expectedSendEnabled,
    });
  });
}

export async function trackedWaitForDeleteWorkspaceConfirmationState(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  dialog: Locator,
  timeoutMs: number,
): Promise<"confirmation" | "retry"> {
  return diagnostics.runAction(actionName, async () => {
    const timeoutAt = Date.now() + timeoutMs;
    let lastObservation = await observeDeleteWorkspaceDialogState(dialog);

    while (Date.now() < timeoutAt) {
      const nextObservation = await observeDeleteWorkspaceDialogState(dialog);
      lastObservation = nextObservation;

      if (nextObservation.state === "confirmation") {
        return "confirmation";
      }

      if (nextObservation.state === "retry") {
        return "retry";
      }

      await page.waitForTimeout(250);
    }

    throw new Error(
      "Delete workspace dialog did not reach confirmation or retry state before timeout "
      + `(state=${lastObservation.state}, loadingVisible=${lastObservation.isLoadingVisible}, `
      + `retryVisible=${lastObservation.isRetryVisible}, `
      + `confirmationPhraseVisible=${lastObservation.isConfirmationPhraseVisible}, `
      + `confirmationInputVisible=${lastObservation.isConfirmationInputVisible})`,
    );
  });
}

export async function trackedWaitForDeleteWorkspaceRetryTransition(
  page: Page,
  diagnostics: LiveSmokeDiagnostics,
  actionName: string,
  dialog: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    await expect.poll(
      async () => {
        const observation = await observeDeleteWorkspaceDialogState(dialog);
        return observation.state !== "retry" || observation.isLoadingVisible;
      },
      { timeout: timeoutMs },
    ).toBe(true);

    await page.waitForTimeout(100);
  });
}

export async function observeDeleteWorkspaceDialogState(
  dialog: Locator,
): Promise<DeleteWorkspaceDialogObservation> {
  const snapshot = await dialog.evaluate((dialogElement): Omit<DeleteWorkspaceDialogObservation, "state"> => {
    const isElementVisible = (selector: string): boolean => {
      const element = dialogElement.querySelector(selector);
      if (element === null) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && element.getClientRects().length > 0;
    };

    const isConfirmationInputVisible = isElementVisible("#delete-workspace-confirmation");
    const isConfirmationPhraseVisible = isElementVisible(".settings-delete-phrase");
    const isRetryVisible = isElementVisible(".screen-actions .primary-btn");
    const isErrorVisible = isElementVisible(".error-banner");
    const isLoadingVisible = isErrorVisible === false && isConfirmationInputVisible === false;

    return {
      isLoadingVisible,
      isRetryVisible,
      isConfirmationPhraseVisible,
      isConfirmationInputVisible,
    };
  });

  const state: DeleteWorkspaceDialogState = snapshot.isConfirmationInputVisible && snapshot.isConfirmationPhraseVisible
    ? "confirmation"
    : snapshot.isRetryVisible
      && snapshot.isLoadingVisible === false
      && snapshot.isConfirmationInputVisible === false
      && snapshot.isConfirmationPhraseVisible === false
      ? "retry"
      : "loading";

  return {
    state,
    isLoadingVisible: snapshot.isLoadingVisible,
    isRetryVisible: snapshot.isRetryVisible,
    isConfirmationPhraseVisible: snapshot.isConfirmationPhraseVisible,
    isConfirmationInputVisible: snapshot.isConfirmationInputVisible,
  };
}
