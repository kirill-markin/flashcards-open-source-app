// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { reviewRoute, shareRoute } from "../../routes";
import { ShareAppScreen } from "./ShareAppScreen";

const localePreferenceStorageKey: string = "flashcards-web-locale-preference";
const shareAppIosHref: string = "https://apps.apple.com/app/apple-store/id6760538964?pt=128797295&ct=share_app&mt=8";
const shareAppAndroidHref: string = "https://play.google.com/store/apps/details?id=com.flashcardsopensourceapp.app&utm_source=flashcards_website&utm_medium=referral&utm_campaign=share_app";
const expectedMcpServerUrl: string = "https://mcp.flashcards-open-source-app.com/mcp";

function createStorageMock(): Storage {
  const state = new Map<string, string>();

  return {
    get length(): number {
      return state.size;
    },
    clear(): void {
      state.clear();
    },
    getItem(key: string): string | null {
      return state.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...state.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      state.delete(key);
    },
    setItem(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

function requireElement(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected element for selector "${selector}"`);
  }

  return element;
}

function setClipboardMock(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function clearClipboardMock(): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
}

describe("ShareAppScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
    window.localStorage.setItem(localePreferenceStorageKey, "en");
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
    clearClipboardMock();
  });

  async function renderShareRoute(): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[shareRoute]}>
          <I18nProvider>
            <Routes>
              <Route path={shareRoute} element={<ShareAppScreen />} />
            </Routes>
          </I18nProvider>
        </MemoryRouter>,
      );
    });
  }

  it("renders localized share copy with platform links in app order", async () => {
    await renderShareRoute();

    const screen: HTMLElement = requireElement(container, "[data-testid='share-app-screen']");
    expect(screen.textContent).toContain("Study with Flashcards");
    expect(screen.textContent).toContain("Choose where you want to use the app.");

    const linkTestIds: ReadonlyArray<string> = Array.from(
      container.querySelectorAll("[data-testid^='share-app-link-']"),
    ).map((element) => {
      const testId: string | null = element.getAttribute("data-testid");
      if (testId === null) {
        throw new Error("Expected platform link test id");
      }

      return testId;
    });
    expect(linkTestIds).toEqual([
      "share-app-link-ios",
      "share-app-link-android",
      "share-app-link-web",
    ]);

    const iosLink: HTMLElement = requireElement(container, "[data-testid='share-app-link-ios']");
    expect(iosLink.getAttribute("href")).toBe(shareAppIosHref);
    const androidLink: HTMLElement = requireElement(container, "[data-testid='share-app-link-android']");
    expect(androidLink.getAttribute("href")).toBe(shareAppAndroidHref);
    const webLink: HTMLElement = requireElement(container, "[data-testid='share-app-link-web']");
    expect(webLink.getAttribute("href")).toBe(`${window.location.origin}${reviewRoute}`);
    expect(webLink.getAttribute("target")).toBe("_blank");

    // A desktop user agent keeps both store QR codes, and the web tile never gets one.
    expect(container.querySelector("[data-testid='share-app-qr-ios']")).not.toBeNull();
    expect(container.querySelector("[data-testid='share-app-qr-android']")).not.toBeNull();
    expect(container.querySelector("[data-testid='share-app-qr-web']")).toBeNull();

    const platformGrid: HTMLElement = requireElement(container, "[data-testid='share-app-grid']");
    const mcpOption: HTMLElement = requireElement(container, "[data-testid='share-app-mcp-option']");
    expect(mcpOption.parentElement).toBe(platformGrid);
    expect(platformGrid.lastElementChild).toBe(mcpOption);
    expect(mcpOption.textContent).toContain("For AI Agent");
    expect(requireElement(container, "[data-testid='share-app-mcp-url']").textContent).toBe(expectedMcpServerUrl);
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-button']").textContent).toBe("Copy");
  });

  it("copies the MCP server URL from the MCP option", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    setClipboardMock(writeText);

    await renderShareRoute();

    const copyButton: HTMLElement = requireElement(container, "[data-testid='share-app-mcp-copy-button']");
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(expectedMcpServerUrl);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-button']").textContent).toBe("Copied");
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-status']").textContent).toBe("Copied");
  });

  it("shows the localized MCP copy failure state when clipboard write rejects", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(
      new DOMException("Clipboard write rejected.", "NotAllowedError"),
    );
    setClipboardMock(writeText);

    await renderShareRoute();

    const copyButton: HTMLElement = requireElement(container, "[data-testid='share-app-mcp-copy-button']");
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(expectedMcpServerUrl);
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-button']").textContent).toBe("Copy failed");
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-status']").textContent).toBe("Copy failed");
  });

  it("shows the localized MCP copy failure state when clipboard is unavailable", async () => {
    clearClipboardMock();

    await renderShareRoute();

    const copyButton: HTMLElement = requireElement(container, "[data-testid='share-app-mcp-copy-button']");
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });

    expect(requireElement(container, "[data-testid='share-app-mcp-copy-button']").textContent).toBe("Copy failed");
    expect(requireElement(container, "[data-testid='share-app-mcp-copy-status']").textContent).toBe("Copy failed");
  });
});
