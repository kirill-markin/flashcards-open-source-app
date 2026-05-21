import { expect, vi } from "vitest";
import { INSTALLATION_ID_STORAGE_KEY } from "../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../i18n/runtime";
import type { ProgressReviewSchedule } from "../types";

type SessionResponseProfile = Readonly<{
  email: string | null;
  locale: string;
  createdAt: string;
}>;

export type SessionResponseOverrides = Readonly<{
  userId?: string;
  selectedWorkspaceId?: string | null;
  authTransport?: "session" | "bearer";
  csrfToken?: string | null;
  profile?: Partial<SessionResponseProfile>;
}>;

export function createStorageMock(): Storage {
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

export function seedLocalBrowserState(): void {
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
  window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "ar");
  window.localStorage.setItem("flashcards-warm-start-snapshot", JSON.stringify({
    version: 1,
  }));
  window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
    version: 1,
  }));
}

export function expectLocalBrowserStateCleared(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  expect(window.localStorage.getItem("flashcards-browser-reauth-required")).toBeNull();
  expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

export function expectLocalBrowserStatePreserved(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).not.toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
  expect(window.localStorage.getItem("flashcards-browser-reauth-required")).toBeNull();
  expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

export function expectLocalBrowserStatePreservedForReauth(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).not.toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
  expect(window.localStorage.getItem("flashcards-browser-reauth-required")).toBe("1");
  expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

export function mockBlockedDeleteDatabase(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onblocked?.(new Event("blocked"));
    });
    return request;
  });
}

export function setNavigatorLanguages(languages: ReadonlyArray<string>, language: string): void {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

export function createSessionResponse(overrides: SessionResponseOverrides | null): Response {
  const baseProfile: SessionResponseProfile = {
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

export function createJsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function createChatConfigResponseValue(): Readonly<{
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

export function createStartChatRunResponse(): Response {
  return createJsonResponse({
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
  });
}

export function createChatSnapshotResponse(): Response {
  return createJsonResponse({
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
  });
}

export function createNewChatSessionResponse(sessionId: string): Response {
  return createJsonResponse({
    ok: true,
    sessionId,
    composerSuggestions: [],
    chatConfig: createChatConfigResponseValue(),
  });
}

export function createStopChatRunResponse(): Response {
  return createJsonResponse({
    sessionId: "session-1",
    stopped: true,
    stillRunning: false,
  });
}

export function createProgressReviewScheduleResponseValue(): ProgressReviewSchedule {
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

export function createProgressReviewScheduleResponse(responseValue: ProgressReviewSchedule): Response {
  return createJsonResponse(responseValue);
}

export function replaceProgressReviewScheduleBucketCount(
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

export function swapFirstProgressReviewScheduleBuckets(schedule: ProgressReviewSchedule): ProgressReviewSchedule {
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
