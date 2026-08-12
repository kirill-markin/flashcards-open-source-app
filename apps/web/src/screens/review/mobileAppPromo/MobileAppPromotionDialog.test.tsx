// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../../api/ApiTestSupport";
import { I18nProvider } from "../../../i18n";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../../i18n/runtime";
import {
  MobileAppPromotionDialog,
  type MobileAppPromotionDialogProps,
  webReviewMobilePromptStoreLinks,
} from "./MobileAppPromotionDialog";

function requireElement(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected element for selector "${selector}"`);
  }

  return element;
}

function requireAnchor(container: HTMLElement, selector: string): HTMLAnchorElement {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLAnchorElement)) {
    throw new Error(`Expected anchor for selector "${selector}"`);
  }

  return element;
}

function requireSvg(container: HTMLElement, selector: string): SVGSVGElement {
  const element = container.querySelector(selector);
  if (!(element instanceof SVGSVGElement)) {
    throw new Error(`Expected SVG for selector "${selector}"`);
  }

  return element;
}

async function dispatchWindowKeyDown(key: string, shiftKey: boolean): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      shiftKey,
    }));
  });
}

describe("MobileAppPromotionDialog", () => {
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

  async function renderDialog(props: MobileAppPromotionDialogProps): Promise<void> {
    await act(async () => {
      root.render(
        <I18nProvider>
          <MobileAppPromotionDialog {...props} />
        </I18nProvider>,
      );
    });
  }

  it("does not render while closed", async () => {
    await renderDialog({
      isOpen: false,
      onDismiss: () => undefined,
      storeLinks: webReviewMobilePromptStoreLinks,
    });

    expect(container.querySelector("[data-testid='mobile-app-promo-dialog']")).toBeNull();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders an accessible dialog and dismisses from the close button", async () => {
    const onDismiss = vi.fn<() => void>();

    await renderDialog({
      isOpen: true,
      onDismiss,
      storeLinks: webReviewMobilePromptStoreLinks,
    });

    const dialog = requireElement(container, "[data-testid='mobile-app-promo-dialog']");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(labelledBy).toBe("mobile-app-promo-title");
    expect(describedBy).toBe("mobile-app-promo-body");
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Review on your phone");
    expect(document.getElementById(describedBy as string)?.textContent).toContain("offline access");

    const closeButton = requireElement(container, "[data-testid='mobile-app-promo-close']");
    expect(closeButton.getAttribute("aria-label")).toBe("Close");

    await act(async () => {
      closeButton.click();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog, dismisses on Escape, and restores prior focus on close", async () => {
    const onDismiss = vi.fn<() => void>();
    const previousFocusButton = document.createElement("button");
    previousFocusButton.type = "button";
    previousFocusButton.setAttribute("data-testid", "mobile-app-promo-trigger");
    document.body.appendChild(previousFocusButton);

    try {
      previousFocusButton.focus();
      expect(document.activeElement).toBe(previousFocusButton);

      await renderDialog({
        isOpen: true,
        onDismiss,
        storeLinks: webReviewMobilePromptStoreLinks,
      });

      const closeButton = requireElement(container, "[data-testid='mobile-app-promo-close']");
      expect(document.activeElement).toBe(closeButton);

      await dispatchWindowKeyDown("Escape", false);
      expect(onDismiss).toHaveBeenCalledTimes(1);

      await renderDialog({
        isOpen: false,
        onDismiss,
        storeLinks: webReviewMobilePromptStoreLinks,
      });

      expect(document.activeElement).toBe(previousFocusButton);
    } finally {
      previousFocusButton.remove();
    }
  });

  it("traps tab focus within the dialog", async () => {
    await renderDialog({
      isOpen: true,
      onDismiss: () => undefined,
      storeLinks: webReviewMobilePromptStoreLinks,
    });

    const closeButton = requireElement(container, "[data-testid='mobile-app-promo-close']");
    const mcpCopyButton = requireElement(container, "[data-testid='mobile-app-promo-mcp-copy-button']");

    mcpCopyButton.focus();
    await dispatchWindowKeyDown("Tab", false);
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    await dispatchWindowKeyDown("Tab", true);
    expect(document.activeElement).toBe(mcpCopyButton);
  });

  it("renders the platform grid cells, store links, and QR output for each platform", async () => {
    await renderDialog({
      isOpen: true,
      onDismiss: () => undefined,
      storeLinks: webReviewMobilePromptStoreLinks,
    });

    const grid = requireElement(container, "[data-testid='mobile-app-promo-grid']");
    const gridTestIds: ReadonlyArray<string> = Array.from(grid.children).map((element) => {
      const testId = element.getAttribute("data-testid");
      if (testId === null) {
        throw new Error("Expected grid cell test id");
      }

      return testId;
    });
    expect(gridTestIds).toEqual([
      "mobile-app-promo-link-ios",
      "mobile-app-promo-link-android",
      "mobile-app-promo-mcp-option",
    ]);

    const iosBadgeLink = requireAnchor(container, "[data-testid='mobile-app-promo-link-ios']");
    const androidBadgeLink = requireAnchor(container, "[data-testid='mobile-app-promo-link-android']");

    expect(iosBadgeLink.href).toBe(webReviewMobilePromptStoreLinks.ios);
    expect(androidBadgeLink.href).toBe(webReviewMobilePromptStoreLinks.android);
    expect(container.querySelector("[data-testid='mobile-app-promo-url-ios']")).toBeNull();
    expect(container.querySelector("[data-testid='mobile-app-promo-url-android']")).toBeNull();

    const iosQr = requireSvg(container, "[data-testid='mobile-app-promo-qr-ios']");
    const androidQr = requireSvg(container, "[data-testid='mobile-app-promo-qr-android']");

    expect(iosQr.getAttribute("role")).toBe("img");
    expect(androidQr.getAttribute("role")).toBe("img");
    expect(iosQr.querySelector("title")?.textContent).toBe("QR code for the iOS app link");
    expect(androidQr.querySelector("title")?.textContent).toBe("QR code for the Android app link");
    expect(iosQr.querySelectorAll("path[d]").length).toBeGreaterThanOrEqual(2);
    expect(androidQr.querySelectorAll("path[d]").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps desktop platform placement left-to-right for rtl locales", async () => {
    window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "ar");

    await renderDialog({
      isOpen: true,
      onDismiss: () => undefined,
      storeLinks: webReviewMobilePromptStoreLinks,
    });

    expect(document.documentElement.dir).toBe("rtl");

    const platformGrid = requireElement(container, "[data-testid='mobile-app-promo-grid']");
    const iosBadgeLink = requireAnchor(container, "[data-testid='mobile-app-promo-link-ios']");
    const androidBadgeLink = requireAnchor(container, "[data-testid='mobile-app-promo-link-android']");

    expect(platformGrid.parentElement?.getAttribute("dir")).toBe("ltr");
    expect(iosBadgeLink.compareDocumentPosition(androidBadgeLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
