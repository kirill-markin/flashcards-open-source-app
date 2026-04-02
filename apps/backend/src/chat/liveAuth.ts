import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../errors";
import { getBackendChatLiveAuthSecret } from "../secrets";

const CHAT_LIVE_AUTH_TOKEN_VERSION = 1;
const CHAT_LIVE_AUTH_TTL_MS = 10 * 60 * 1000;

type ChatLiveAuthPayload = Readonly<{
  version: number;
  userId: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  expiresAt: number;
}>;

export type ChatLiveStreamEnvelope = Readonly<{
  url: string;
  authorization: string;
  expiresAt: number;
}>;

type VerifiedChatLiveAuth = Readonly<{
  userId: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
}>;

function getChatLiveUrl(): string {
  const chatLiveUrl = process.env.CHAT_LIVE_URL;
  if (chatLiveUrl === undefined || chatLiveUrl.trim() === "") {
    throw new Error("CHAT_LIVE_URL is required for chat live streaming");
  }

  return chatLiveUrl;
}

function getBackendChatLiveAuthSecretArn(): string {
  const secretArn = process.env.BACKEND_CHAT_LIVE_AUTH_SECRET_ARN;
  if (secretArn === undefined || secretArn.trim() === "") {
    throw new Error("BACKEND_CHAT_LIVE_AUTH_SECRET_ARN is required for chat live auth");
  }

  return secretArn;
}

function encodePayload(payload: ChatLiveAuthPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function decodePayload(encodedPayload: string): ChatLiveAuthPayload {
  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<ChatLiveAuthPayload>;
    if (
      typeof parsed.version !== "number"
      || typeof parsed.userId !== "string"
      || parsed.userId.trim() === ""
      || typeof parsed.workspaceId !== "string"
      || parsed.workspaceId.trim() === ""
      || typeof parsed.sessionId !== "string"
      || parsed.sessionId.trim() === ""
      || typeof parsed.runId !== "string"
      || parsed.runId.trim() === ""
      || typeof parsed.expiresAt !== "number"
      || Number.isFinite(parsed.expiresAt) === false
    ) {
      throw new Error("Chat live auth payload is invalid");
    }

    return {
      version: parsed.version,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      sessionId: parsed.sessionId,
      runId: parsed.runId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    throw new HttpError(401, "Chat live auth token is invalid", "CHAT_LIVE_AUTH_INVALID");
  }
}

function isMatchingSignature(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function createChatLiveStreamEnvelope(
  userId: string,
  workspaceId: string,
  sessionId: string,
  runId: string,
): Promise<ChatLiveStreamEnvelope> {
  const expiresAt = Date.now() + CHAT_LIVE_AUTH_TTL_MS;
  const payload: ChatLiveAuthPayload = {
    version: CHAT_LIVE_AUTH_TOKEN_VERSION,
    userId,
    workspaceId,
    sessionId,
    runId,
    expiresAt,
  };
  const secret = await getBackendChatLiveAuthSecret(getBackendChatLiveAuthSecretArn());
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload, secret);

  return {
    url: getChatLiveUrl(),
    authorization: `Live ${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export async function verifyChatLiveAuthorizationHeader(
  authorizationHeader: string,
  sessionId: string,
  runId: string,
): Promise<VerifiedChatLiveAuth> {
  if (authorizationHeader.startsWith("Live ") === false) {
    throw new HttpError(401, "Chat live auth header must use Live scheme", "CHAT_LIVE_AUTH_INVALID");
  }

  const token = authorizationHeader.slice(5).trim();
  if (token === "") {
    throw new HttpError(401, "Chat live auth token is missing", "CHAT_LIVE_AUTH_INVALID");
  }

  const [encodedPayload, providedSignature] = token.split(".", 2);
  if (
    encodedPayload === undefined
    || encodedPayload === ""
    || providedSignature === undefined
    || providedSignature === ""
  ) {
    throw new HttpError(401, "Chat live auth token is malformed", "CHAT_LIVE_AUTH_INVALID");
  }

  const secret = await getBackendChatLiveAuthSecret(getBackendChatLiveAuthSecretArn());
  const expectedSignature = signPayload(encodedPayload, secret);
  if (isMatchingSignature(expectedSignature, providedSignature) === false) {
    throw new HttpError(401, "Chat live auth token signature is invalid", "CHAT_LIVE_AUTH_INVALID");
  }

  const payload = decodePayload(encodedPayload);
  if (payload.version !== CHAT_LIVE_AUTH_TOKEN_VERSION) {
    throw new HttpError(401, "Chat live auth token version is invalid", "CHAT_LIVE_AUTH_INVALID");
  }
  if (payload.expiresAt <= Date.now()) {
    throw new HttpError(401, "Chat live auth token expired", "CHAT_LIVE_AUTH_EXPIRED");
  }
  if (payload.sessionId !== sessionId) {
    throw new HttpError(401, "Chat live auth session mismatch", "CHAT_LIVE_AUTH_INVALID");
  }
  if (payload.runId !== runId) {
    throw new HttpError(401, "Chat live auth run mismatch", "CHAT_LIVE_AUTH_INVALID");
  }

  return {
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    sessionId: payload.sessionId,
    runId: payload.runId,
  };
}
