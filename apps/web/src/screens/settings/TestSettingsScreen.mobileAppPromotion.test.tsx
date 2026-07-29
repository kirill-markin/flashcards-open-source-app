// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppErrorDialogProvider } from "../../appError/AppErrorContext";
import { createStorageMock } from "../../api/ApiTestSupport";
import { I18nProvider } from "../../i18n";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../i18n/runtime";
import { TestSettingsScreen } from "./TestSettingsScreen";

function requireElement(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid='${testId}']`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected element with test id "${testId}"`);
  }

  return element;
}

describe("TestSettingsScreen mobile app promotion preview", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  async function renderTestSettingsScreen(): Promise<void> {
    await act(async () => {
      root.render(
        <I18nProvider>
          <AppErrorDialogProvider>
            <MemoryRouter>
              <TestSettingsScreen />
            </MemoryRouter>
          </AppErrorDialogProvider>
        </I18nProvider>,
      );
    });
  }

  it("opens and dismisses the mobile app promo dialog from the test settings action", async () => {
    await renderTestSettingsScreen();

    const promoRow = requireElement(container, "test-settings-mobile-app-promo-row");
    expect(promoRow).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      promoRow.click();
    });

    expect(requireElement(container, "mobile-app-promo-dialog")).toBeTruthy();
    expect(requireElement(container, "mobile-app-promo-platform-ios")).toBeTruthy();
    expect(requireElement(container, "mobile-app-promo-platform-android")).toBeTruthy();

    const closeButton = requireElement(container, "mobile-app-promo-close");
    await act(async () => {
      closeButton.click();
    });

    expect(container.querySelector("[data-testid='mobile-app-promo-dialog']")).toBeNull();
  });
});
