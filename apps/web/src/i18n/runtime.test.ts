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

  it("matches a supported locale from navigator.languages with BCP47 regional tags", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "en-US",
      languages: ["fr-FR", "es-MX", "en-GB"],
    });

    expect(resolution).toEqual({
      locale: "es",
      matchedLanguageTag: "es-MX",
      source: "navigator.languages",
    });
  });

  it("falls back to navigator.language when navigator.languages does not match", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "en-GB",
      languages: ["fr-FR"],
    });

    expect(resolution).toEqual({
      locale: "en",
      matchedLanguageTag: "en-GB",
      source: "navigator.language",
    });
  });

  it("falls back to English when no supported browser locale is available", () => {
    const resolution = resolveBrowserLocaleFromSnapshot({
      language: "fr-FR",
      languages: ["de-DE", "pt-BR"],
    });

    expect(resolution).toEqual({
      locale: "en",
      matchedLanguageTag: null,
      source: "fallback",
    });
  });

  it("persists explicit locale preferences and clears auto mode from storage", () => {
    expect(readStoredLocalePreference()).toBe("auto");

    persistLocalePreference("es");
    expect(readStoredLocalePreference()).toBe("es");

    persistLocalePreference("auto");
    expect(readStoredLocalePreference()).toBe("auto");
  });

  it("uses the explicit locale preference ahead of browser detection", () => {
    const localeState = resolveLocaleState("es");

    expect(localeState).toEqual({
      locale: "es",
      localePreference: "es",
      matchedBrowserLanguageTag: null,
      source: "storage",
    });
    expect(translateMessage(localeState.locale, "navigation.review", undefined)).toBe("Repasar");
  });
});
