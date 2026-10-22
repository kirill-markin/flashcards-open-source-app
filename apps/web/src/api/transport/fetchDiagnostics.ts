import { readLastApiResponseAtMs } from "./lastApiResponse";

// Only names explicitly supplied by this app; SDK/browser-injected headers are not observed here.
const appHeaderNames = [
  "accept",
  "content-type",
  "x-chat-resume-attempt-id",
  "x-client-platform",
  "x-client-version",
  "x-csrf-token",
  "x-openai-api-key",
] as const;

type AppHeaderName = typeof appHeaderNames[number];

export type ApiFetchDiagnostics = Readonly<{
  apiOrigin: string | null;
  appHeaderNames: ReadonlyArray<AppHeaderName>;
  fetchIdentityMode: RequestCredentials;
  elapsedMs: number;
  onlineAtStart: boolean | null;
  onlineAtFailure: boolean | null;
  visibilityAtFailure: DocumentVisibilityState | null;
  lastCompleteApiResponseAgeMs: number | null;
}>;

type ApiFetchAttempt = Readonly<{
  apiOrigin: string | null;
  appHeaderNames: ReadonlyArray<AppHeaderName>;
  fetchIdentityMode: RequestCredentials;
  startedAtMs: number;
  onlineAtStart: boolean | null;
}>;

function readApiOrigin(apiBaseUrl: string): string | null {
  try {
    return new URL(apiBaseUrl, typeof window === "undefined" ? undefined : window.location.href).origin;
  } catch {
    // Invalid request URLs must still fail through the existing fetch error path.
    return null;
  }
}

function readOnlineHint(): boolean | null {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : null;
}

function readVisibility(): DocumentVisibilityState | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.visibilityState === "visible" || document.visibilityState === "hidden"
    ? document.visibilityState
    : null;
}

export function startApiFetchAttempt(
  apiBaseUrl: string,
  headers: Headers,
  fetchIdentityMode: RequestCredentials,
): ApiFetchAttempt {
  return {
    apiOrigin: readApiOrigin(apiBaseUrl),
    appHeaderNames: appHeaderNames.filter((name: AppHeaderName): boolean => headers.has(name)),
    fetchIdentityMode,
    startedAtMs: performance.now(),
    onlineAtStart: readOnlineHint(),
  };
}

export function captureApiFetchFailure(attempt: ApiFetchAttempt): ApiFetchDiagnostics {
  const elapsedMs = performance.now() - attempt.startedAtMs;
  const lastApiResponseAtMs = readLastApiResponseAtMs();

  return {
    apiOrigin: attempt.apiOrigin,
    appHeaderNames: attempt.appHeaderNames,
    fetchIdentityMode: attempt.fetchIdentityMode,
    elapsedMs,
    onlineAtStart: attempt.onlineAtStart,
    onlineAtFailure: readOnlineHint(),
    visibilityAtFailure: readVisibility(),
    lastCompleteApiResponseAgeMs: lastApiResponseAtMs === null ? null : Date.now() - lastApiResponseAtMs,
  };
}
