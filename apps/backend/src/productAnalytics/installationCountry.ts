import type { DatabaseExecutor } from "../database";
import type { ProductAnalyticsInstallationObservation } from "./types";

type CountryProfileRow = Readonly<{ country_sampled_at: Date | null }>;
type CountryPeriodRow = Readonly<{ country: string | null; first_seen: Date; last_seen: Date }>;

export async function sampleInstallationCountryInTransaction(
  executor: DatabaseExecutor,
  installation: ProductAnalyticsInstallationObservation,
): Promise<void> {
  if (installation.countryLookup === null) return;
  const key = [installation.anonymousId, installation.platform];
  const profile = await executor.query<CountryProfileRow>(
    `SELECT country_sampled_at FROM analytics.installation_profiles
     WHERE anonymous_id = $1::uuid AND platform = $2 FOR UPDATE`,
    key,
  );
  const row = profile.rows[0];
  if (row === undefined) throw new Error("Country sampling requires an existing locked installation profile.");
  const sampledAt = installation.observedAt;
  if (row.country_sampled_at !== null
    && row.country_sampled_at.toISOString().slice(0, 10) >= sampledAt.toISOString().slice(0, 10)) return;

  // Lookup failures abort the batch so a broken/expired database is retried, never stored as unknown.
  const country = await installation.countryLookup();
  const periods = await executor.query<CountryPeriodRow>(
    `SELECT country, first_seen, last_seen FROM analytics.installation_country_observations
     WHERE anonymous_id = $1::uuid AND platform = $2 ORDER BY first_seen DESC LIMIT 1 FOR UPDATE`,
    key,
  );
  const latest = periods.rows[0];
  // An expired period cannot be revived before the retention job reaches it.
  if (latest !== undefined && latest.country === country
    && latest.last_seen.getTime() >= sampledAt.getTime() - 90 * 86_400_000) {
    await executor.query(
      `UPDATE analytics.installation_country_observations SET last_seen = $3, sampled_at = $3
       WHERE anonymous_id = $1::uuid AND platform = $2 AND first_seen = $4`,
      [...key, sampledAt, latest.first_seen],
    );
  } else {
    await executor.query(
      `INSERT INTO analytics.installation_country_observations
       (anonymous_id, platform, country, first_seen, last_seen, sampled_at, source)
       VALUES ($1::uuid, $2, $3, $4, $4, $4, 'geoip')`,
      [...key, country, sampledAt],
    );
  }
  await executor.query(
    `UPDATE analytics.installation_profiles SET country_sampled_at = $3,
       first_country = COALESCE(first_country, $4),
       first_country_sampled_at = CASE WHEN first_country IS NULL AND $4::text IS NOT NULL
         THEN $3 ELSE first_country_sampled_at END
     WHERE anonymous_id = $1::uuid AND platform = $2`,
    [...key, sampledAt, country],
  );
}
