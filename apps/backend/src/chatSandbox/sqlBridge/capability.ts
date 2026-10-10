import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getBackendChatLiveAuthSecret } from "../../aws/secrets";
import { getBackendChatLiveAuthSecretArn } from "../../chat/live/auth";
import { HttpError } from "../../shared/errors";
import type { ChatSandboxSqlBridge } from "../contract";

/**
 * The capability one `bash` command's code calls agent SQL with: it names one claimed chat run of one
 * user and workspace and expires within minutes, and the bridge route also requires that run to still
 * be running under the same claim. Its key is derived for this purpose alone from the chat live signing
 * secret, so neither token passes for the other and no secret of its own is needed.
 */

const capabilityVersion = 1;
const signingKeyLabel = "chat-sandbox-sql-v1";
/** One command and its uploads fit the sandbox Lambda's 2-minute timeout, with room for the invoke to queue. */
const capabilityTtlMs = 5 * 60 * 1000;
const authorizationScheme = "ChatSandbox ";

export const chatSandboxSqlRoutePath = "/chat/sandbox/sql";

const capabilityPayloadSchema = z.object({
  version: z.literal(capabilityVersion),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  claimToken: z.string().min(1),
  expiresAt: z.number().int(),
}).strict();

type CapabilityPayload = z.infer<typeof capabilityPayloadSchema>;

export type ChatSandboxSqlCapability = Readonly<{
  runId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  claimToken: string;
}>;

function createInvalidCapabilityError(reason: string): HttpError {
  return new HttpError(401, `The chat sandbox SQL capability ${reason}.`, "CHAT_SANDBOX_SQL_AUTH_INVALID");
}

async function loadSigningKey(): Promise<Buffer> {
  const secret = await getBackendChatLiveAuthSecret(getBackendChatLiveAuthSecretArn());
  return createHmac("sha256", secret).update(signingKeyLabel).digest();
}

function signPayload(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(encodedPayload).digest();
}

/** The published API origin: the sandbox runs in no VPC, so it reaches the API over the internet. */
function getBridgeUrl(): string {
  const apiBaseUrl = process.env.PUBLIC_API_BASE_URL?.trim();
  if (apiBaseUrl === undefined || apiBaseUrl === "") {
    throw new Error("PUBLIC_API_BASE_URL is required for the chat sandbox SQL bridge");
  }

  return `${apiBaseUrl.replace(/\/+$/u, "")}${chatSandboxSqlRoutePath}`;
}

function decodePayload(encodedPayload: string): CapabilityPayload {
  try {
    return capabilityPayloadSchema.parse(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
  } catch {
    throw createInvalidCapabilityError("payload is invalid");
  }
}

/** Minted by the chat worker for every sandbox attempt of a `bash` call. */
export async function createChatSandboxSqlBridge(capability: ChatSandboxSqlCapability): Promise<ChatSandboxSqlBridge> {
  const payload: CapabilityPayload = {
    version: capabilityVersion,
    runId: capability.runId,
    sessionId: capability.sessionId,
    userId: capability.userId,
    workspaceId: capability.workspaceId,
    claimToken: capability.claimToken,
    expiresAt: Date.now() + capabilityTtlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(encodedPayload, await loadSigningKey()).toString("base64url");
  return {
    url: getBridgeUrl(),
    authorization: `${authorizationScheme}${encodedPayload}.${signature}`,
  };
}

export async function verifyChatSandboxSqlAuthorization(
  authorizationHeader: string | undefined,
): Promise<ChatSandboxSqlCapability> {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith(authorizationScheme)) {
    throw createInvalidCapabilityError("must be sent with the ChatSandbox authorization scheme");
  }

  const parts = authorizationHeader.slice(authorizationScheme.length).split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw createInvalidCapabilityError("is malformed");
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload, await loadSigningKey());
  const providedSignatureBytes = Buffer.from(providedSignature, "base64url");
  if (
    providedSignatureBytes.length !== expectedSignature.length
    || !timingSafeEqual(providedSignatureBytes, expectedSignature)
  ) {
    throw createInvalidCapabilityError("signature is invalid");
  }

  const payload = decodePayload(encodedPayload);
  if (payload.expiresAt <= Date.now()) {
    throw new HttpError(401, "The chat sandbox SQL capability expired.", "CHAT_SANDBOX_SQL_AUTH_EXPIRED");
  }

  return {
    runId: payload.runId,
    sessionId: payload.sessionId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    claimToken: payload.claimToken,
  };
}
