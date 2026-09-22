import type { DatabaseExecutor } from "../database";

type GuestSessionAnalyticsConsentColumnExistsRow = Readonly<{
  column_exists: boolean;
}>;

let guestSessionAnalyticsConsentColumnKnownPresent = false;

/**
 * Guards reads and writes of auth.guest_sessions.analytics_consent during the rollout of migration
 * 0146, which the release applies after the new Lambda code is already serving traffic.
 *
 * Deliberately its own probe and its own cache rather than a reuse of
 * `guestSessionPlatformColumnExistsInExecutor`: that one latched true releases ago and would wave
 * through a column the database does not have yet.
 */
export async function guestSessionAnalyticsConsentColumnExistsInExecutor(
  executor: DatabaseExecutor,
): Promise<boolean> {
  if (guestSessionAnalyticsConsentColumnKnownPresent) {
    return true;
  }

  const result = await executor.query<GuestSessionAnalyticsConsentColumnExistsRow>(
    [
      "SELECT EXISTS (",
      "SELECT 1",
      "FROM information_schema.columns",
      "WHERE table_schema = 'auth'",
      "AND table_name = 'guest_sessions'",
      "AND column_name = 'analytics_consent'",
      ") AS column_exists",
    ].join(" "),
    [],
  );
  const columnExists = result.rows[0]?.column_exists === true;
  if (columnExists) {
    guestSessionAnalyticsConsentColumnKnownPresent = true;
  }

  return columnExists;
}
