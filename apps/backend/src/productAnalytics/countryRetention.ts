import { unsafeQueryWithDeadline } from "../database/unsafe";

export const countryObservationRetentionDays = 90;
const retentionBatchSize = 1_000;
const retentionMaxBatches = 100;

export type CountryRetentionResult = Readonly<{ deleted: number; cutoff: string; finished: boolean }>;

export async function retainRecentCountryObservations(
  observedAt: Date,
  deadlineAtMs: number,
): Promise<CountryRetentionResult> {
  const cutoff = new Date(observedAt.getTime() - countryObservationRetentionDays * 86_400_000).toISOString();
  let deleted = 0;
  for (let batch = 0; batch < retentionMaxBatches && Date.now() < deadlineAtMs - 5_000; batch += 1) {
    const result = await unsafeQueryWithDeadline(
      Math.min(deadlineAtMs, Date.now() + 5_000),
      `WITH expired AS (
         SELECT anonymous_id, platform, first_seen
         FROM analytics.installation_country_observations
         WHERE last_seen < $1::timestamptz
         ORDER BY last_seen LIMIT $2 FOR UPDATE SKIP LOCKED
       ) DELETE FROM analytics.installation_country_observations AS observations
       USING expired WHERE observations.anonymous_id = expired.anonymous_id
         AND observations.platform = expired.platform AND observations.first_seen = expired.first_seen`,
      [cutoff, retentionBatchSize],
    );
    deleted += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < retentionBatchSize) {
      const remaining = await unsafeQueryWithDeadline<Readonly<{ remaining: boolean }>>(
        Math.min(deadlineAtMs, Date.now() + 5_000),
        `SELECT EXISTS (SELECT 1 FROM analytics.installation_country_observations
         WHERE last_seen < $1::timestamptz) AS remaining`,
        [cutoff],
      );
      return { deleted, cutoff, finished: remaining.rows[0]?.remaining === false };
    }
  }
  return { deleted, cutoff, finished: false };
}
