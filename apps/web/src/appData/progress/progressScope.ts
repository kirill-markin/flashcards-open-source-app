import type {
  CloudSettings,
  ProgressScopeKey,
  ProgressSeriesInput,
  ProgressSummaryInput,
  WorkspaceSummary,
} from "../../types";
import type { SessionVerificationState } from "../warmStart";

export type ProgressSourceSections = Readonly<{
  includeSummary: boolean;
  includeSeries: boolean;
}>;

export function collectAccessibleWorkspaceIds(
  activeWorkspaceId: string | null,
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>,
): ReadonlyArray<string> {
  const workspaceIds = new Set<string>();

  for (const workspace of availableWorkspaces) {
    workspaceIds.add(workspace.workspaceId);
  }

  if (activeWorkspaceId !== null) {
    workspaceIds.add(activeWorkspaceId);
  }

  return [...workspaceIds].sort((leftWorkspaceId, rightWorkspaceId) => leftWorkspaceId.localeCompare(rightWorkspaceId));
}

export function buildProgressScopeKey(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSeriesInput,
): ProgressScopeKey {
  return `${workspaceIds.join(",")}::${input.timeZone}::${input.from}::${input.to}`;
}

export function buildProgressSummaryScopeKey(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSummaryInput,
): ProgressScopeKey {
  return `${workspaceIds.join(",")}::${input.timeZone}::${input.today}`;
}

export function resolveProgressSummaryScopeKey(
  includeSummary: boolean,
  accessibleWorkspaceIds: ReadonlyArray<string>,
  input: ProgressSummaryInput,
): ProgressScopeKey | null {
  if (includeSummary === false || accessibleWorkspaceIds.length === 0) {
    return null;
  }

  return buildProgressSummaryScopeKey(accessibleWorkspaceIds, input);
}

export function resolveProgressSeriesScopeKey(
  includeSeries: boolean,
  accessibleWorkspaceIds: ReadonlyArray<string>,
  input: ProgressSeriesInput,
): ProgressScopeKey | null {
  if (includeSeries === false || accessibleWorkspaceIds.length === 0) {
    return null;
  }

  return buildProgressScopeKey(accessibleWorkspaceIds, input);
}

export function canLoadProgressServerBase(
  sessionVerificationState: SessionVerificationState,
  cloudSettings: CloudSettings | null,
): boolean {
  return sessionVerificationState === "verified" && cloudSettings?.cloudState === "linked";
}

export function buildProgressRefreshKey(
  scopeKey: ProgressScopeKey,
  progressServerInvalidationVersion: number,
  manualRefreshVersion: number,
): string {
  return `${scopeKey}::${progressServerInvalidationVersion}::${manualRefreshVersion}`;
}

export function resolveProgressRefreshKey(
  scopeKey: ProgressScopeKey | null,
  canLoadServerBase: boolean,
  progressServerInvalidationVersion: number,
  manualRefreshVersion: number,
): string | null {
  if (scopeKey === null || canLoadServerBase === false) {
    return null;
  }

  return buildProgressRefreshKey(scopeKey, progressServerInvalidationVersion, manualRefreshVersion);
}
