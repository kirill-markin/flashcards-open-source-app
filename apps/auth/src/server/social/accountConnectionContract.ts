import type { verifyCurrentAccountSession } from "../browserSession.js";
import type { SocialClient } from "./providers.js";
import type { AuthAttemptBinding } from "./attemptContract.js";

export type ConnectionSession = Awaited<ReturnType<typeof verifyCurrentAccountSession>>;
export type ConnectionBinding = AuthAttemptBinding & Readonly<{ purpose: "reauth" }>;
export type ConnectionSqlParameters = readonly [string, string, string, number | null, string, SocialClient, string | null];
export type ConnectionState = "collecting" | "proved" | "cancelled" | "committed";
export type ConnectionReceipt = Readonly<{
  operation: string;
  state: ConnectionState;
  account: string;
  targetAccount: string | null;
  expiresAt: string;
}>;
export type ConnectionRow = Readonly<{
  state: ConnectionState; source_account: string; target_account: string | null; expires_at: Date;
}>;
export type ConnectionEmailRow = ConnectionRow & Readonly<{
  email_claim: string; target_subject: string; target_username: string; target_email: string;
  challenge_ciphertext: string;
}>;
export type ConnectionReplay = Readonly<{ consentDigest: string; result: string }>;

export class AccountConnectionError extends Error {
  constructor(readonly code: "ACCOUNT_CONNECTION_INVALID" | "ACCOUNT_CONNECTION_RESTART_REQUIRED" | "ACCOUNT_CONNECTION_RATE_LIMITED") {
    super(code);
    this.name = "AccountConnectionError";
  }
}
