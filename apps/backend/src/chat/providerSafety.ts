import { createHash } from "node:crypto";

export function hashAIProviderUserId(userId: string): string {
  if (userId.trim() === "") {
    throw new Error("AI provider user ID must not be empty");
  }

  return createHash("sha256").update(userId).digest("hex");
}
