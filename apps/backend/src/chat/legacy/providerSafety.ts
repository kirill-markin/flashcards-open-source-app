/**
 * Legacy chat backend provider-safety helpers for old `/chat/turn` clients.
 * The backend-first `/chat` stack handles provider identity and persistence differently on the server.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { createHash } from "node:crypto";

/**
 * This legacy chat backend entrypoint hashes the end-user identifier before sending it to providers for old `/chat/turn` clients.
 * The backend-first `/chat` stack manages provider requests through a different server-owned flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function hashAIProviderUserId(userId: string): string {
  if (userId.trim() === "") {
    throw new Error("AI provider user ID must not be empty");
  }

  return createHash("sha256").update(userId).digest("hex");
}
