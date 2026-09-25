import { transactionWithWorkspaceScopeDeadline, type DatabaseExecutor } from "../../database";
import {
  GeneratedCardImageGenerationLimitReachedError,
  type GeneratedCardImageGenerationCeiling,
} from "./providerTypes";

const dailyGeneratedCardImageGenerationLimit = 100;
const monthlyGeneratedCardImageGenerationLimit = 300;
// The one anti-abuse ceiling for generations paid with the person's own OpenAI key, which replaces both
// platform ceilings.
const monthlyOwnKeyGeneratedCardImageGenerationLimit = 1000;

export type GeneratedCardImageGenerationBudgetScope = Readonly<{
  userId: string;
  workspaceId: string;
  replicaId: string;
  operationDeadlineMs: number;
}>;

export type GeneratedCardImageGenerationWindowUsage = Readonly<{
  count: number;
  resetsAt: string;
}>;

export type GeneratedCardImageGenerationUsage = Readonly<{
  daily: GeneratedCardImageGenerationWindowUsage;
  monthly: GeneratedCardImageGenerationWindowUsage;
}>;

type GenerationWindowUsageRow = Readonly<{
  generation_count: number;
  resets_at: string;
}>;

// Both windows are truncated and advanced as UTC wall-clock timestamps and converted back with
// AT TIME ZONE 'UTC', so neither depends on the session TimeZone; month arithmetic on a
// session-zone timestamptz would.
const DAILY_GENERATION_USAGE_SQL = `WITH usage_window AS (
  SELECT date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AS starts_at_utc
)
SELECT
  (
    SELECT count(*)::int
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.workspace_id = $1
      AND jobs.replica_id = $2
      AND NOT jobs.user_supplied_key
      AND jobs.created_at >= usage_window.starts_at_utc AT TIME ZONE 'UTC'
      AND jobs.created_at < (usage_window.starts_at_utc + interval '1 day') AT TIME ZONE 'UTC'
  ) AS generation_count,
  to_char(usage_window.starts_at_utc + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resets_at
FROM usage_window`;

const MONTHLY_GENERATION_USAGE_SQL = `WITH usage_window AS (
  SELECT date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC') AS starts_at_utc
)
SELECT
  (
    SELECT count(*)::int
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.workspace_id = $1
      AND NOT jobs.user_supplied_key
      AND jobs.created_at >= usage_window.starts_at_utc AT TIME ZONE 'UTC'
      AND jobs.created_at < (usage_window.starts_at_utc + interval '1 month') AT TIME ZONE 'UTC'
  ) AS generation_count,
  to_char(usage_window.starts_at_utc + interval '1 month', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resets_at
FROM usage_window`;

// The own-key ceiling's window: every generation in the workspace this UTC month, whoever paid for it.
const MONTHLY_ALL_GENERATION_USAGE_SQL = `WITH usage_window AS (
  SELECT date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC') AS starts_at_utc
)
SELECT
  (
    SELECT count(*)::int
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.workspace_id = $1
      AND jobs.created_at >= usage_window.starts_at_utc AT TIME ZONE 'UTC'
      AND jobs.created_at < (usage_window.starts_at_utc + interval '1 month') AT TIME ZONE 'UTC'
  ) AS generation_count,
  to_char(usage_window.starts_at_utc + interval '1 month', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resets_at
FROM usage_window`;

function toGenerationWindowUsage(
  row: GenerationWindowUsageRow | undefined,
  ceiling: GeneratedCardImageGenerationCeiling,
): GeneratedCardImageGenerationWindowUsage {
  if (row === undefined) {
    throw new Error(`Generated card image ${ceiling} generation usage query returned no row.`);
  }
  return { count: row.generation_count, resetsAt: row.resets_at };
}

export async function loadGeneratedCardImageGenerationUsageInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
): Promise<GeneratedCardImageGenerationUsage> {
  const daily = await executor.query<GenerationWindowUsageRow>(
    DAILY_GENERATION_USAGE_SQL, [workspaceId, replicaId],
  );
  const monthly = await executor.query<GenerationWindowUsageRow>(
    MONTHLY_GENERATION_USAGE_SQL, [workspaceId],
  );
  return {
    daily: toGenerationWindowUsage(daily.rows[0], "daily"),
    monthly: toGenerationWindowUsage(monthly.rows[0], "monthly"),
  };
}

/**
 * Counts promotion jobs paid with the platform key, which exist only once a generation has been staged, so
 * a paid generation that never reached staging is not counted. Distinct operations that pass this check
 * before any of them enqueues all proceed, so concurrent generations in one scope can end past a limit.
 */
export async function assertGeneratedCardImageGenerationBudgetAvailable(
  scope: GeneratedCardImageGenerationBudgetScope,
): Promise<void> {
  const usage = await transactionWithWorkspaceScopeDeadline(
    { userId: scope.userId, workspaceId: scope.workspaceId },
    scope.operationDeadlineMs,
    async (executor) => loadGeneratedCardImageGenerationUsageInExecutor(
      executor, scope.workspaceId, scope.replicaId,
    ),
  );
  // Monthly is reported first when both are exhausted, because its reset is never earlier.
  if (usage.monthly.count >= monthlyGeneratedCardImageGenerationLimit) {
    throw new GeneratedCardImageGenerationLimitReachedError(
      "monthly", monthlyGeneratedCardImageGenerationLimit, usage.monthly.resetsAt,
    );
  }
  if (usage.daily.count >= dailyGeneratedCardImageGenerationLimit) {
    throw new GeneratedCardImageGenerationLimitReachedError(
      "daily", dailyGeneratedCardImageGenerationLimit, usage.daily.resetsAt,
    );
  }
}

/** The race described above applies here too. */
export async function assertOwnKeyGeneratedCardImageGenerationBudgetAvailable(
  scope: GeneratedCardImageGenerationBudgetScope,
): Promise<void> {
  const monthly = await transactionWithWorkspaceScopeDeadline(
    { userId: scope.userId, workspaceId: scope.workspaceId },
    scope.operationDeadlineMs,
    async (executor) => {
      const result = await executor.query<GenerationWindowUsageRow>(
        MONTHLY_ALL_GENERATION_USAGE_SQL, [scope.workspaceId],
      );
      return toGenerationWindowUsage(result.rows[0], "monthly");
    },
  );
  if (monthly.count >= monthlyOwnKeyGeneratedCardImageGenerationLimit) {
    throw new GeneratedCardImageGenerationLimitReachedError(
      "monthly", monthlyOwnKeyGeneratedCardImageGenerationLimit, monthly.resetsAt,
    );
  }
}
