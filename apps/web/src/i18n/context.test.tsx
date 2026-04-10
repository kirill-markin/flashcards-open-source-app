// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./context";

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

function DirectionProbe(): ReactElement {
  const { direction, locale, t } = useI18n();

  return (
    <main data-direction={direction} data-locale={locale}>
      <span>{t("navigation.review")}</span>
    </main>
  );
}

describe("I18nProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
    document.documentElement.lang = "";
    document.documentElement.dir = "";

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    document.documentElement.lang = "";
    document.documentElement.dir = "";
  });

  it("applies rtl direction to the document and rendered content for Arabic", async () => {
    window.localStorage.setItem("flashcards-web-locale-preference", "ar");

    if (root === null || container === null) {
      throw new Error("I18nProvider test root is not ready");
    }

    await act(async () => {
      root.render(
        <I18nProvider>
          <DirectionProbe />
        </I18nProvider>,
      );
    });

    const probe = container.querySelector("main");
    if (!(probe instanceof HTMLElement)) {
      throw new Error("Direction probe was not rendered");
    }

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(probe.dataset.locale).toBe("ar");
    expect(probe.dataset.direction).toBe("rtl");
    expect(probe.textContent).toContain("مراجعة");
  });
});
