import type { verifyCurrentAccountSession } from "../browserSession.js";
import type { SocialClient } from "./providers.js";
import type { AuthAttemptBinding } from "./attemptContract.js";

export type ConnectionSession = Awaited<ReturnType<typeof verifyCurrentAccountSession>>;
export type ConnectionBinding = AuthAttemptBinding & Readonly<{ purpose: "reauth" }>;
export type ConnectionSqlParameters = readonly [string, string, string, number | null, string, SocialClient, string | null];
export type ConnectionState = "collecting" | "proved" | "cancelled" | "committed";
export type ConnectionReceipt = Readonly<{
  operation: string;
  operationId: string;
  state: ConnectionState;
  account: string;
  targetAccount: string | null;
  expiresAt: string;
  outcome: "already_connected" | null;
}>;
export type ConnectionRow = Readonly<{
  operation_id: string; state: ConnectionState; source_account: string; target_account: string | null; expires_at: Date; terminal_outcome?: "already_connected" | null;
}>;
export type ConnectionEmailRow = ConnectionRow & Readonly<{
  email_claim: string; target_subject: string; target_username: string; target_email: string;
  challenge_ciphertext: string;
}>;
export type ConnectionSuggestion = Readonly<{ suggestion: string; expiresAt: string }>;
export type ConnectionChoices = Readonly<{
  operationId: string;
  omittedWorkspaceIds: readonly string[];
  historicalBaselines: Readonly<Record<string, Readonly<{ workspace: string; cards: string }>>>;
  preview: ConnectionUnionPreview;
  digest: string;
}>;
export type ConnectionReplay = Readonly<{ consentDigest: string; result: string }>;
export type ConnectionPreview = Readonly<{
  choices: ConnectionChoices;
  omissionCandidateWorkspaceIds: readonly string[];
}>;

export class AccountConnectionError extends Error {
  constructor(readonly code: "ACCOUNT_CONNECTION_INVALID" | "ACCOUNT_CONNECTION_RESTART_REQUIRED" | "ACCOUNT_CONNECTION_RATE_LIMITED") {
    super(code);
    this.name = "AccountConnectionError";
  }
}

export type ConnectionUnionResult = Readonly<{
  operationId: string; sourceUserId: string; canonicalAccountId: string; selectedWorkspaceId: string;
  workspaceIds: readonly string[]; suppressedWorkspaceIds: readonly string[];
}>;
export type ConnectionCommitted = Readonly<{ status: "connected"; operationId: string; result: ConnectionUnionResult }>;
export type ConnectionAction =
  | Readonly<{ action: "begin"; capability: "canonical-account-v1"; sourceCompletion: string }>
  | Readonly<{ action: "adopt"; capability: "canonical-account-v1"; suggestion: string }>
  | Readonly<{ action: "load" | "cancel"; operation: string }>
  | Readonly<{ action: "provider_begin"; operation: string; provider: "apple" | "google"; codeChallenge: string | null }>
  | Readonly<{ action: "provider_complete"; operation: string; attempt: string; submission: import("./attemptContract.js").AuthProviderSubmission }>
  | Readonly<{ action: "email_send"; operation: string; email: string }>
  | Readonly<{ action: "email_verify"; operation: string; code: string }>
  | Readonly<{ action: "preview"; operation: string; omittedWorkspaceIds: readonly string[] }>
  | Readonly<{ action: "confirm"; operation: string; omittedWorkspaceIds: readonly string[]; previewDigest: string; accepted: true }>;
export type ConnectionActionResult =
  | Readonly<{ status: "proof_required" | "proved"; receipt: ConnectionReceipt }>
  | Readonly<{ status: "already_connected" | "cancelled"; operation: string }>
  | Readonly<{ status: "provider_required"; proof: import("./attemptContract.js").AuthAttemptResponse }>
  | Readonly<{ status: "email_required"; email: string; expiresAt: string }>
  | (ConnectionPreview & Readonly<{ status: "preview"; operation: string; consequences: typeof connectionConsequences }>)
  | ConnectionCommitted;

export type ConnectionUnionPreview = Readonly<{
  sourceUserId: string; targetUserId: string; rowLimit: number; workspaceLimit: number; ownerRows: number; fingerprint: string;
  workspaces: readonly Readonly<{ workspace: Readonly<{
    workspace_id: string; name: string; creation_origin: string; starter_suppressed_at: string | null;
  }>; unusedStarter: boolean }>[];
  workspaceIds: readonly string[]; selectedWorkspaceId: string; suppressedWorkspaceIds: readonly string[];
  settingsPolicy: "target_with_restrictive_privacy"; publicProfilePolicy: "target_with_restrictive_visibility";
}>;
export const connectionConsequences = {
  data: "retained",
  memberships: "union_with_owner_precedence",
  integrations: "credentials_keep_ids_and_follow_canonical_account",
  billing: "purchases_grants_and_usage_follow_canonical_account",
  subscriptions: "provider_subscriptions_unchanged",
  trials: "original_trial_history_retained",
  primaryEmail: "retain_genuine_primary_or_use_proved_usable_real_email",
} as const;
