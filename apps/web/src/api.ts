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
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
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

  return payload as unknown as SessionInfo;
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
