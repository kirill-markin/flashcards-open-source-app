import { createHash } from "node:crypto";

const OPENAI_SAFETY_IDENTIFIER_PREFIX = "v1_";

export function buildOpenAISafetyIdentifier(userId: string): string {
  const normalizedUserId = userId.trim();
  if (normalizedUserId === "") {
    throw new Error("OpenAI safety identifier source userId must not be empty");
  }

  const digest = createHash("sha256")
    .update(normalizedUserId, "utf8")
    .digest("base64url");

  return `${OPENAI_SAFETY_IDENTIFIER_PREFIX}${digest}`;
}
