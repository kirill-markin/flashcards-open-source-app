// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  persistLocalePreference,
  readStoredLocalePreference,
  resolveBrowserLocaleFromSnapshot,
  resolveLocaleState,
  translateMessage,
} from "./runtime";

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

describe("i18n runtime", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
  });

  it("prefers an exact supported locale match from navigator.languages", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "en-US",
      languages: ["es-MX", "es", "en-GB"],
    });

    expect(resolution).toEqual({
      locale: "es-MX",
      matchedLanguageTag: "es-MX",
      source: "navigator.languages",
    });
  });

  it("falls back to a supported locale family when the browser tag is more specific than the app locale", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "en-US",
      languages: ["zh-CN"],
    });

    expect(resolution).toEqual({
      locale: "zh-Hans",
      matchedLanguageTag: "zh-CN",
      source: "navigator.languages",
    });
  });

  it("falls back to navigator.language when navigator.languages does not match", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "es",
      languages: ["fr-FR"],
    });

    expect(resolution).toEqual({
      locale: "es-ES",
      matchedLanguageTag: "es",
      source: "navigator.language",
    });
  });

  it("falls back to English when no supported browser locale is available", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "fr-FR",
      languages: ["pt-BR", "it-IT"],
    });

    expect(resolution).toEqual({
      locale: "en",
      matchedLanguageTag: null,
      source: "fallback",
    });
  });

  it("persists explicit locale preferences and clears auto mode from storage", () => {
    expect(readStoredLocalePreference()).toBe("auto");

    persistLocalePreference("es-MX");
    expect(readStoredLocalePreference()).toBe("es-MX");

    persistLocalePreference("auto");
    expect(readStoredLocalePreference()).toBe("auto");
  });

  it("migrates a legacy stored Spanish preference to an exact locale tag", () => {
    window.localStorage.setItem("flashcards-web-locale-preference", "es");

    expect(readStoredLocalePreference()).toBe("es-ES");
    expect(window.localStorage.getItem("flashcards-web-locale-preference")).toBe("es-ES");
  });

  it("uses the explicit locale preference ahead of browser detection", () => {
    const localeState = resolveLocaleState("es-MX");

    expect(localeState).toEqual({
      locale: "es-MX",
      direction: "ltr",
      localePreference: "es-MX",
      matchedBrowserLanguageTag: null,
      source: "storage",
    });
    expect(translateMessage(localeState.locale, "navigation.review", undefined)).toBe("Repasar");
  });

  it("exposes rtl direction metadata for supported rtl locales", () => {
    const localeState = resolveLocaleState("ar");

    expect(localeState.direction).toBe("rtl");
  });
});
