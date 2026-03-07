import { getAppConfig } from "./config";
import type { Card, SessionInfo } from "./types";

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type JsonObject = Record<string, unknown>;
type SessionCsrfState = "unknown" | "session" | "non-session";

let sessionCsrfToken: string | null = null;
let sessionCsrfState: SessionCsrfState = "unknown";

// The web app bootstraps session state from /me once and reuses the token for
// all later unsafe requests sent with the shared domain session cookie.
function setSessionCsrfToken(csrfToken: string | null, authTransport: string): void {
  sessionCsrfToken = csrfToken;
  sessionCsrfState = authTransport === "session" ? "session" : "non-session";
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function getMethod(init: RequestInit): string {
  return typeof init.method === "string" && init.method !== "" ? init.method.toUpperCase() : "GET";
}

function createHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (isUnsafeMethod(getMethod(init))) {
    // Failing early here keeps missing session bootstrap visible instead of
    // silently sending a mutating request without the required CSRF header.
    if (sessionCsrfState === "unknown") {
      throw new Error("Session must be loaded before sending mutating requests");
    }

    if (sessionCsrfState === "session") {
      const csrfToken = sessionCsrfToken;
      if (csrfToken === null || csrfToken === "") {
        throw new Error("CSRF token is not loaded for this browser session");
      }

      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  return headers;
}

function getJsonErrorMessage(value: unknown, fallbackMessage: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallbackMessage;
  }

  const objectValue = value as Record<string, unknown>;
  const errorValue = objectValue.error;
  return typeof errorValue === "string" && errorValue !== "" ? errorValue : fallbackMessage;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request(
  pathname: string,
  init: RequestInit,
): Promise<unknown> {
  const config = getAppConfig();
  const response = await fetch(`${config.apiBaseUrl}${pathname}`, {
    ...init,
    credentials: "include",
    headers: createHeaders(init),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const fallbackMessage = typeof payload === "string" ? payload : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, getJsonErrorMessage(payload, fallbackMessage));
  }

  return payload;
}

function expectObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("API response must be a JSON object");
  }

  return value as JsonObject;
}

export async function getSession(): Promise<SessionInfo> {
  const payload = expectObject(await request("/me", { method: "GET" }));
  const session = payload as unknown as SessionInfo;
  setSessionCsrfToken(session.csrfToken, session.authTransport);
  return session;
}

export async function getCards(): Promise<ReadonlyArray<Card>> {
  const payload = expectObject(await request("/cards", { method: "GET" }));
  return payload.items as ReadonlyArray<Card>;
}

export async function createCard(frontText: string, backText: string): Promise<Card> {
  const payload = expectObject(await request("/cards", {
    method: "POST",
    body: JSON.stringify({ frontText, backText }),
  }));

  return payload.card as Card;
}

export async function getReviewQueue(): Promise<ReadonlyArray<Card>> {
  const payload = expectObject(await request("/review-queue", { method: "GET" }));
  return payload.items as ReadonlyArray<Card>;
}

export async function submitReview(cardId: string, rating: 0 | 1 | 2 | 3): Promise<Card> {
  const payload = expectObject(await request("/reviews", {
    method: "POST",
    body: JSON.stringify({
      cardId,
      rating,
      reviewedAtClient: new Date().toISOString(),
    }),
  }));

  return payload.card as Card;
}

export function buildLoginUrl(): string {
  const config = getAppConfig();
  const redirectUri = `${config.appBaseUrl}/`;
  return `${config.authBaseUrl}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
}
