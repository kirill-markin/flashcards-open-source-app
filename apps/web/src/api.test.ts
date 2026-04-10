// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRedirectError,
  buildLoginUrl,
  createNewChatSession,
  getPreferredAuthUiLocale,
  getSession,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
  startChatRun,
} from "./api";
import { persistLocalePreference } from "./i18n/runtime";

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

function createSessionResponse(): Response {
  return new Response(JSON.stringify({
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: "csrf-token-1",
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-04-10T00:00:00.000Z",
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createChatConfigResponseValue(): Readonly<{
  provider: Readonly<{ id: "openai"; label: string }>;
  model: Readonly<{ id: string; label: string; badgeLabel: string }>;
  reasoning: Readonly<{ effort: "medium"; label: string }>;
  features: Readonly<{
    modelPickerEnabled: boolean;
    dictationEnabled: boolean;
    attachmentsEnabled: boolean;
  }>;
}> {
  return {
    provider: {
      id: "openai",
      label: "OpenAI",
    },
    model: {
      id: "gpt-5",
      label: "GPT-5",
      badgeLabel: "Fast",
    },
    reasoning: {
      effort: "medium",
      label: "Balanced",
    },
    features: {
      modelPickerEnabled: true,
      dictationEnabled: true,
      attachmentsEnabled: true,
    },
  };
}

function createStartChatRunResponse(): Response {
  return new Response(JSON.stringify({
    accepted: true,
    sessionId: "session-1",
    conversationScopeId: "session-1",
    conversation: {
      messages: [],
      updatedAt: 1,
      mainContentInvalidationVersion: 0,
    },
    composerSuggestions: [],
    chatConfig: createChatConfigResponseValue(),
    activeRun: null,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createNewChatSessionResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    sessionId: "session-1",
    composerSuggestions: [],
    chatConfig: createChatConfigResponseValue(),
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  resetApiClientStateForTests();
});

afterEach(() => {
  window.localStorage.clear();
  setNavigatorLanguages([], "");
  resetApiClientStateForTests();
  vi.restoreAllMocks();
});

describe("auth locale login URL plumbing", () => {
  it("prefers the stored app locale over raw browser detection", () => {
    persistLocalePreference("ar");
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");

    expect(getPreferredAuthUiLocale()).toBe("ar");
  });

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

  it("uses the stored app locale when auth recovery redirects to login", async () => {
    persistLocalePreference("ar");
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toBeInstanceOf(AuthRedirectError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(redirectedUrl).searchParams.get("locale")).toBe("ar");
  });
});

describe("AI chat locale transport", () => {
  it("includes uiLocale in POST /chat requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createStartChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await startChatRun({
      sessionId: "session-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    });

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    }));
  });

  it("includes uiLocale in POST /chat/new requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await createNewChatSession("session-1", "es-ES");

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      uiLocale: "es-ES",
    }));
  });
});
