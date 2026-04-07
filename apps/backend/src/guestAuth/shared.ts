import { createHash } from "node:crypto";

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function hashGuestToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}
