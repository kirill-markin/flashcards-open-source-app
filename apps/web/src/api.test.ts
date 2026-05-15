// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRedirectError,
  buildLoginUrl,
  createNewChatSession,
  getChatSnapshot,
  getPreferredAuthUiLocale,
  getSession,
  loadProgressSummary,
  loadProgressSeries,
  loadProgressReviewSchedule,
  resetApiClientStateForTests,
  setNavigationHandlerForTests,
  startChatRun,
  stopChatRun,
  transcribeChatAudio,
} from "./api";
import { isAuthResetRequired } from "./accountDeletion";
import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY, persistLocalePreference } from "./i18n/runtime";
import type { ProgressReviewSchedule } from "./types";

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

function seedLocalBrowserState(): void {
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
  window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "ar");
  window.localStorage.setItem("flashcards-warm-start-snapshot", JSON.stringify({
    version: 1,
  }));
  window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
    version: 1,
  }));
}

function expectLocalBrowserStateCleared(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

function expectLocalBrowserStatePreserved(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).not.toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

function mockBlockedDeleteDatabase(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onblocked?.(new Event("blocked"));
    });
    return request;
  });
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

function createSessionResponse(
  overrides?: Partial<Readonly<{
    userId: string;
    selectedWorkspaceId: string | null;
    authTransport: "session" | "bearer";
    csrfToken: string | null;
    profile: Readonly<{
      email: string | null;
      locale: string;
      createdAt: string;
    }>;
  }>>,
): Response {
  const baseProfile = {
    email: "user@example.com",
    locale: "en",
    createdAt: "2026-04-10T00:00:00.000Z",
  };

  return new Response(JSON.stringify({
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: "csrf-token-1",
    ...overrides,
    profile: {
      ...baseProfile,
      ...overrides?.profile,
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

function createChatSnapshotResponse(): Response {
  return new Response(JSON.stringify({
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

function createNewChatSessionResponse(
  sessionId: string = "session-1",
): Response {
  return new Response(JSON.stringify({
    ok: true,
    sessionId,
    composerSuggestions: [],
    chatConfig: createChatConfigResponseValue(),
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createStopChatRunResponse(): Response {
  return new Response(JSON.stringify({
    sessionId: "session-1",
    stopped: true,
    stillRunning: false,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createProgressReviewScheduleResponseValue(): ProgressReviewSchedule {
  return {
    timeZone: "Europe/Madrid",
    generatedAt: "2026-04-18T09:15:00.000Z",
    totalCards: 12,
    buckets: [
      { key: "new", count: 2 },
      { key: "today", count: 3 },
      { key: "days1To7", count: 1 },
      { key: "days8To30", count: 2 },
      { key: "days31To90", count: 1 },
      { key: "days91To360", count: 1 },
      { key: "years1To2", count: 1 },
      { key: "later", count: 1 },
    ],
  };
}

function createProgressReviewScheduleResponse(responseValue: ProgressReviewSchedule): Response {
  return new Response(JSON.stringify(responseValue), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function replaceProgressReviewScheduleBucketCount(
  schedule: ProgressReviewSchedule,
  bucketIndex: number,
  count: number,
): ProgressReviewSchedule {
  return {
    ...schedule,
    buckets: schedule.buckets.map((bucket, index) => index === bucketIndex ? {
      ...bucket,
      count,
    } : bucket),
  };
}

function swapFirstProgressReviewScheduleBuckets(schedule: ProgressReviewSchedule): ProgressReviewSchedule {
  const firstBucket = schedule.buckets[0];
  const secondBucket = schedule.buckets[1];
  if (firstBucket === undefined || secondBucket === undefined) {
    throw new Error("Progress review schedule test fixture must include at least two buckets");
  }

  return {
    ...schedule,
    buckets: [
      secondBucket,
      firstBucket,
      ...schedule.buckets.slice(2),
    ],
  };
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
    seedLocalBrowserState();
    persistLocalePreference("ar");
    setNavigatorLanguages(["fr-FR", "pt-BR"], "fr-FR");
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");

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
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(new URL(redirectedUrl).searchParams.get("locale")).toBe("ar");
    await vi.waitFor(() => {
      expectLocalBrowserStateCleared();
      expect(isAuthResetRequired()).toBe(false);
    });
  });

  it("treats a second 401 after refresh recovery as an auth redirect", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toBeInstanceOf(AuthRedirectError);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(new URL(redirectedUrl).pathname).toBe("/login");
    await vi.waitFor(() => {
      expectLocalBrowserStateCleared();
      expect(isAuthResetRequired()).toBe(false);
    });
  });

  it("surfaces a refresh-service 500 without redirecting to login", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Authentication failed. Try again.",
        code: "INTERNAL_ERROR",
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    let redirectedUrl = "";
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });

    await expect(getSession()).rejects.toThrow("Authentication failed. Try again.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(redirectedUrl).toBe("");
    expectLocalBrowserStatePreserved();
  });

  it("deduplicates cleanup for parallel requests that end in one auth redirect", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const redirectedUrls: Array<string> = [];
    setNavigationHandlerForTests((url: string) => {
      redirectedUrls.push(url);
    });

    const results = await Promise.allSettled([getSession(), getSession()]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AuthRedirectError);
      }
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(redirectedUrls).toHaveLength(1);
    await vi.waitFor(() => {
      expectLocalBrowserStateCleared();
      expect(isAuthResetRequired()).toBe(false);
    });
  });

  it("redirects to login even when IndexedDB cleanup is blocked", async () => {
    seedLocalBrowserState();
    const deleteDatabaseSpy = mockBlockedDeleteDatabase();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(new URL(redirectedUrl).pathname).toBe("/login");
    await vi.waitFor(() => {
      expectLocalBrowserStateCleared();
      expect(isAuthResetRequired()).toBe(true);
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith("auth_reset_cleanup_deferred", {
      errorMessage: "Failed to delete IndexedDB: delete request was blocked",
    });
  });
});

describe("progress API decoding", () => {
  it("decodes progress summary responses with generatedAt metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        generatedAt: "2026-04-18T09:15:00.000Z",
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-18T09:15:00.000Z",
      summary: {
        currentStreakDays: 1,
        hasReviewedToday: true,
        lastReviewedOn: "2026-04-03",
        activeReviewDays: 2,
      },
    });
  });

  it("decodes progress series responses without summary metadata", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: "2026-04-18T09:15:00.000Z",
        dailyReviews: [
          {
            date: "2026-04-01",
            reviewCount: 3,
          },
          {
            date: "2026-04-02",
            reviewCount: 0,
          },
          {
            date: "2026-04-03",
            reviewCount: 1,
          },
        ],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).resolves.toEqual({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
      generatedAt: "2026-04-18T09:15:00.000Z",
      dailyReviews: [
        {
          date: "2026-04-01",
          reviewCount: 3,
        },
        {
          date: "2026-04-02",
          reviewCount: 0,
        },
        {
          date: "2026-04-03",
          reviewCount: 1,
        },
      ],
    });
  });

  it("decodes review schedule responses and sends only the timezone query", async () => {
    const responseValue = createProgressReviewScheduleResponseValue();
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createProgressReviewScheduleResponse(responseValue));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).resolves.toEqual(responseValue);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/me/progress/review-schedule?timeZone=Europe%2FMadrid",
      expect.objectContaining({ method: "GET" }),
    );
  });

  const invalidProgressReviewScheduleCases: ReadonlyArray<Readonly<{
    name: string;
    responseValue: ProgressReviewSchedule;
    expectedErrorMessage: string;
  }>> = [
    {
      name: "negative bucket count",
      responseValue: replaceProgressReviewScheduleBucketCount(createProgressReviewScheduleResponseValue(), 0, -1),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].count must be non-negative integer",
    },
    {
      name: "fractional bucket count",
      responseValue: replaceProgressReviewScheduleBucketCount(createProgressReviewScheduleResponseValue(), 0, 1.5),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].count must be non-negative integer",
    },
    {
      name: "negative totalCards",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: -1,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be non-negative integer",
    },
    {
      name: "fractional totalCards",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: 12.5,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be non-negative integer",
    },
    {
      name: "totalCards that does not equal the bucket sum",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        totalCards: 13,
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: totalCards must be sum of bucket counts (12)",
    },
    {
      name: "unstable bucket order",
      responseValue: swapFirstProgressReviewScheduleBuckets(createProgressReviewScheduleResponseValue()),
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: buckets[0].key must be bucket key new",
    },
    {
      name: "mismatched timezone",
      responseValue: {
        ...createProgressReviewScheduleResponseValue(),
        timeZone: "UTC",
      },
      expectedErrorMessage: "Invalid API response for GET /me/progress/review-schedule: timeZone must be \"Europe/Madrid\"",
    },
  ];

  for (const invalidCase of invalidProgressReviewScheduleCases) {
    it(`rejects review schedule responses with ${invalidCase.name}`, async () => {
      const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
        .mockResolvedValueOnce(createProgressReviewScheduleResponse(invalidCase.responseValue));
      vi.stubGlobal("fetch", fetchMock);

      await expect(loadProgressReviewSchedule({
        timeZone: "Europe/Madrid",
        today: "2026-04-18",
      })).rejects.toThrow(invalidCase.expectedErrorMessage);
    });
  }

  // Backend always emits `generatedAt` as a non-null string for the progress endpoints.
  // The wire parser must fail loud (no silent null fallback) when the field is missing
  // or null on the wire.
  it("rejects review schedule responses with missing generatedAt", async () => {
    const baseResponse = createProgressReviewScheduleResponseValue();
    const responseWithoutGeneratedAt = {
      timeZone: baseResponse.timeZone,
      totalCards: baseResponse.totalCards,
      buckets: baseResponse.buckets,
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(responseWithoutGeneratedAt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/review-schedule: generatedAt must be string",
    );
  });

  it("rejects review schedule responses with null generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...createProgressReviewScheduleResponseValue(),
        generatedAt: null,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressReviewSchedule({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/review-schedule: generatedAt must be string",
    );
  });

  it("rejects progress summary responses with missing generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        summary: {
          currentStreakDays: 1,
          hasReviewedToday: true,
          lastReviewedOn: "2026-04-03",
          activeReviewDays: 2,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSummary({
      timeZone: "Europe/Madrid",
      today: "2026-04-18",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/summary: generatedAt must be string",
    );
  });

  it("rejects progress series responses with null generatedAt", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: "Europe/Madrid",
        from: "2026-04-01",
        to: "2026-04-03",
        generatedAt: null,
        dailyReviews: [
          { date: "2026-04-01", reviewCount: 0 },
          { date: "2026-04-02", reviewCount: 0 },
          { date: "2026-04-03", reviewCount: 0 },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProgressSeries({
      timeZone: "Europe/Madrid",
      from: "2026-04-01",
      to: "2026-04-03",
    })).rejects.toThrow(
      "Invalid API response for GET /me/progress/series: generatedAt must be string",
    );
  });
});

describe("AI chat transport", () => {
  it("bootstraps session transport before the first unsafe chat request", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "es-ES");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(new Headers(chatRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("reloads the session CSRF token and retries once after a stale CSRF rejection", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-1",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Invalid X-CSRF-Token header",
        code: "SESSION_CSRF_TOKEN_INVALID",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "en");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const staleRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const retriedRequestInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    expect(new Headers(staleRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(new Headers(retriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
  });

  it("uses normal auth recovery when the retry after stale CSRF returns unauthorized", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-1",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Invalid X-CSRF-Token header",
        code: "SESSION_CSRF_TOKEN_INVALID",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-2",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: "csrf-token-3",
      }))
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "en");

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/chat/new");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[6]?.[0]).toBe("http://localhost:8080/v1/chat/new");

    const firstRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const csrfRetriedRequestInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    const authRetriedRequestInit = fetchMock.mock.calls[6]?.[1] as RequestInit | undefined;
    expect(new Headers(firstRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(new Headers(csrfRetriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
    expect(new Headers(authRetriedRequestInit?.headers).get("X-CSRF-Token")).toBe("csrf-token-3");
  });

  it("deduplicates session transport bootstrap for parallel unsafe requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createNewChatSessionResponse("session-1"))
      .mockResolvedValueOnce(createNewChatSessionResponse("session-2"));
    vi.stubGlobal("fetch", fetchMock);

    const [firstResponse, secondResponse] = await Promise.all([
      createNewChatSession("session-1", "workspace-1", "en"),
      createNewChatSession("session-2", "workspace-1", "en"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter((call) => call[0] === "http://localhost:8080/v1/me")).toHaveLength(1);
    expect(firstResponse.sessionId).toBe("session-1");
    expect(secondResponse.sessionId).toBe("session-2");
  });

  it("recovers an expired session before the first unsafe chat request", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createNewChatSession("session-1", "workspace-1", "en");

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:8081/api/refresh-session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://localhost:8080/v1/me");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://localhost:8080/v1/chat/new");
  });

  it("surfaces local CSRF preconditions without mapping them to API unavailable", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse({
        csrfToken: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createNewChatSession("session-1", "workspace-1", "en")).rejects.toThrow(
      "CSRF token is not loaded for this browser session",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes workspaceId and uiLocale in POST /chat requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createStartChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await startChatRun({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    });

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      clientRequestId: "request-1",
      content: [{ type: "text", text: "hello" }],
      timezone: "Europe/Madrid",
      uiLocale: "ja",
    }));
  });

  it("includes workspaceId and uiLocale in POST /chat/new requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createNewChatSessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await createNewChatSession("session-1", "workspace-1", "es-ES");

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      uiLocale: "es-ES",
    }));
  });

  it("includes workspaceId in GET /chat requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createChatSnapshotResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await getChatSnapshot("session-1", "workspace-1");

    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/chat");
    expect(requestUrl.searchParams.get("sessionId")).toBe("session-1");
    expect(requestUrl.searchParams.get("workspaceId")).toBe("workspace-1");
  });

  it("accepts reduced POST /chat/stop responses without unused run identifiers", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await expect(stopChatRun("session-1", "workspace-1", null)).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
    }));
  });

  it("includes runId in POST /chat/stop requests when known", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(createStopChatRunResponse());
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await expect(stopChatRun("session-1", "workspace-1", "run-1")).resolves.toEqual({
      sessionId: "session-1",
      stopped: true,
      stillRunning: false,
    });

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(chatRequestInit?.body).toBe(JSON.stringify({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      runId: "run-1",
    }));
  });

  it("includes workspaceId in POST /chat/transcriptions requests", async () => {
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(createSessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "hello",
        sessionId: "session-1",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await getSession();
    await transcribeChatAudio(
      new Blob(["audio"], { type: "audio/webm" }),
      "web",
      "session-1",
      "workspace-1",
    );

    const chatRequestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const formData = chatRequestInit?.body;
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) {
      throw new Error("Expected FormData");
    }

    expect(formData.get("sessionId")).toBe("session-1");
    expect(formData.get("workspaceId")).toBe("workspace-1");
    expect(formData.get("source")).toBe("web");
    expect(formData.get("file")).toBeInstanceOf(File);
  });
});
