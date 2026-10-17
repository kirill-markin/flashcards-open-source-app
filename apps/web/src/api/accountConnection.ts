import { getAppConfig } from "../config";
import { AccountMethodError, accountMethodHandle, requestAccountMethod, type AccountProvider } from "./accountMethods";

export type ConnectionConsent = Readonly<{ action: "confirm"; operation: string; omittedWorkspaceIds: ReadonlyArray<string>; previewDigest: string; accepted: true }>;
export type ConnectionPreview = Readonly<{
  status: "preview";
  operation: string;
  choices: Readonly<{
    operationId: string;
    omittedWorkspaceIds: ReadonlyArray<string>;
    historicalBaselines: Readonly<Record<string, Readonly<{ workspace: string; cards: string }>>>;
    digest: string;
    preview: Readonly<{
      sourceUserId: string; targetUserId: string; rowLimit: number; workspaceLimit: number; ownerRows: number; fingerprint: string;
      workspaces: ReadonlyArray<Readonly<{ workspace: Readonly<{ workspace_id: string; name: string;
        creation_origin: string; starter_suppressed_at: string | null }>; unusedStarter: boolean }>>;
      workspaceIds: ReadonlyArray<string>; selectedWorkspaceId: string; suppressedWorkspaceIds: ReadonlyArray<string>;
      settingsPolicy: "target_with_restrictive_privacy"; publicProfilePolicy: "target_with_restrictive_visibility";
    }>;
  }>;
  omissionCandidateWorkspaceIds: ReadonlyArray<string>;
}>;
export type ConnectionResponse = ConnectionPreview
  | Readonly<{ status: "proof_required" | "proved"; receipt: Readonly<{ operation: string; operationId: string; expiresAt: string }> }>
  | Readonly<{ status: "already_connected" | "cancelled"; operation: string }>
  | Readonly<{ status: "email_required"; email: string; expiresAt: string }>
  | Readonly<{ status: "provider_required"; authorizationUrl: string; expiresAt: string }>
  | Readonly<{ status: "connected"; operationId: string; result: Readonly<{
    operationId: string; sourceUserId: string; canonicalAccountId: string; selectedWorkspaceId: string;
    workspaceIds: ReadonlyArray<string>; suppressedWorkspaceIds: ReadonlyArray<string>;
  }> }>;
export type ConnectionAction = ConnectionConsent
  | Readonly<{ action: "begin"; capability: "canonical-account-v1"; sourceCompletion: string }>
  | Readonly<{ action: "adopt"; capability: "canonical-account-v1"; suggestion: string }>
  | Readonly<{ action: "load" | "cancel"; operation: string }>
  | Readonly<{ action: "provider_begin"; operation: string; provider: AccountProvider; codeChallenge: null; redirectUri: string }>
  | Readonly<{ action: "email_send"; operation: string; email: string }>
  | Readonly<{ action: "email_verify"; operation: string; code: string }>
  | Readonly<{ action: "preview"; operation: string; omittedWorkspaceIds: ReadonlyArray<string> }>;

function invalid(): never { throw new AccountMethodError("AUTH_COMPLETION_INVALID"); }
function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Readonly<Record<string, unknown>>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return invalid();
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function strings(value: unknown): ReadonlyArray<string> { return Array.isArray(value) ? value.map(text) : invalid(); }
function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
export function parseConnectionConsent(value: unknown): ConnectionConsent {
  const fields = object(value);
  if (fields.action !== "confirm" || fields.accepted !== true || !/^[0-9a-f]{64}$/.test(text(fields.previewDigest))) return invalid();
  return { action: "confirm", operation: accountMethodHandle(fields.operation), omittedWorkspaceIds: strings(fields.omittedWorkspaceIds),
    previewDigest: text(fields.previewDigest), accepted: true };
}
export function parseConnectionPreview(value: unknown): ConnectionPreview {
  const fields = object(value);
  if (fields.status !== "preview") return invalid();
  const choices = object(fields.choices);
  const preview = object(choices.preview);
  if (!Array.isArray(preview.workspaces) || preview.settingsPolicy !== "target_with_restrictive_privacy"
    || preview.publicProfilePolicy !== "target_with_restrictive_visibility" || !/^[0-9a-f]{64}$/.test(text(choices.digest))) return invalid();
  const baselines = object(choices.historicalBaselines);
  return { status: "preview", operation: accountMethodHandle(fields.operation),
    omissionCandidateWorkspaceIds: strings(fields.omissionCandidateWorkspaceIds),
    choices: { operationId: text(choices.operationId), omittedWorkspaceIds: strings(choices.omittedWorkspaceIds), digest: text(choices.digest),
      historicalBaselines: Object.fromEntries(Object.entries(baselines).map(([id, value]) => {
        const baseline = object(value);
        return [id, { workspace: text(baseline.workspace), cards: text(baseline.cards) }];
      })),
      preview: { sourceUserId: text(preview.sourceUserId), targetUserId: text(preview.targetUserId),
        rowLimit: count(preview.rowLimit), workspaceLimit: count(preview.workspaceLimit), ownerRows: count(preview.ownerRows), fingerprint: text(preview.fingerprint),
        workspaceIds: strings(preview.workspaceIds), selectedWorkspaceId: text(preview.selectedWorkspaceId),
        suppressedWorkspaceIds: strings(preview.suppressedWorkspaceIds), settingsPolicy: preview.settingsPolicy,
        publicProfilePolicy: preview.publicProfilePolicy, workspaces: preview.workspaces.map((value: unknown) => {
          const row = object(value); const workspace = object(row.workspace);
          if (typeof row.unusedStarter !== "boolean") return invalid();
          return { workspace: { workspace_id: text(workspace.workspace_id), name: text(workspace.name), creation_origin: text(workspace.creation_origin),
            starter_suppressed_at: workspace.starter_suppressed_at === null ? null : timestamp(workspace.starter_suppressed_at) }, unusedStarter: row.unusedStarter };
        }) },
    } };
}
function parseResponse(fields: Readonly<Record<string, unknown>>): ConnectionResponse {
  switch (fields.status) {
    case "preview": {
      const consequences = object(fields.consequences);
      if (consequences.data !== "retained" || consequences.memberships !== "union_with_owner_precedence"
        || consequences.integrations !== "credentials_keep_ids_and_follow_canonical_account"
        || consequences.billing !== "purchases_grants_and_usage_follow_canonical_account"
        || consequences.subscriptions !== "provider_subscriptions_unchanged" || consequences.trials !== "original_trial_history_retained"
        || consequences.primaryEmail !== "retain_genuine_primary_or_use_proved_usable_real_email") return invalid();
      return parseConnectionPreview(fields);
    }
    case "proof_required": case "proved": {
      const receipt = object(fields.receipt);
      return { status: fields.status, receipt: { operation: accountMethodHandle(receipt.operation), operationId: text(receipt.operationId),
        expiresAt: timestamp(receipt.expiresAt) } };
    }
    case "already_connected": case "cancelled": return { status: fields.status, operation: accountMethodHandle(fields.operation) };
    case "email_required": return { status: fields.status, email: text(fields.email), expiresAt: timestamp(fields.expiresAt) };
    case "provider_required": return { status: fields.status, authorizationUrl: text(fields.authorizationUrl), expiresAt: timestamp(fields.expiresAt) };
    case "connected": {
      const result = object(fields.result);
      const operationId = text(fields.operationId);
      if (result.operationId !== operationId) return invalid();
      return { status: "connected", operationId, result: { operationId, sourceUserId: text(result.sourceUserId),
        canonicalAccountId: text(result.canonicalAccountId), selectedWorkspaceId: text(result.selectedWorkspaceId),
        workspaceIds: strings(result.workspaceIds), suppressedWorkspaceIds: strings(result.suppressedWorkspaceIds) } };
    }
    default: return invalid();
  }
}
export async function accountConnection(csrfToken: string, action: ConnectionAction, signal: AbortSignal): Promise<ConnectionResponse> {
  return parseResponse(await requestAccountMethod("/api/account/connection", { ...action, client: "web", csrfToken }, signal));
}
export function connectionProviderUrl(value: string, provider: AccountProvider): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== ""
    || url.hostname !== (provider === "google" ? "accounts.google.com" : "appleid.apple.com")) return invalid();
  return url.toString();
}
export function accountConnectionReturnUrl(): string {
  return getAppConfig().appBaseUrl + "/settings/account-status?account_connection=1";
}
