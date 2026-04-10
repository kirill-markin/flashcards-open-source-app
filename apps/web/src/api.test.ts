// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildLoginUrl, getPreferredAuthUiLocale } from "./api";

function setNavigatorLanguages(languages: ReadonlyArray<string>, language: string): void {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

afterEach(() => {
  setNavigatorLanguages([], "");
});

describe("auth locale login URL plumbing", () => {
  it("prefers the first supported browser language", () => {
    setNavigatorLanguages(["fr-FR", "es-MX", "en-GB"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("es-MX");
  });

  it("maps compatible browser locales to the supported exact locale set", () => {
    setNavigatorLanguages(["zh-CN"], "zh-CN");

    expect(getPreferredAuthUiLocale()).toBe("zh-Hans");
  });

  it("falls back to English when browser languages are unsupported", () => {
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("en");
  });

  it("includes a sanitized locale hint in the login URL", () => {
    const loginUrl = new URL(buildLoginUrl("https://app.flashcards-open-source-app.com/review", "es-MX"));

    expect(loginUrl.origin).toBe("http://localhost:8081");
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("redirect_uri")).toBe("https://app.flashcards-open-source-app.com/review");
    expect(loginUrl.searchParams.get("locale")).toBe("es-MX");
  });

  it("upgrades a legacy base-language locale hint to an exact supported locale tag", () => {
    const loginUrl = new URL(buildLoginUrl("https://app.flashcards-open-source-app.com/review", "es"));

    expect(loginUrl.searchParams.get("locale")).toBe("es-ES");
  });
});
