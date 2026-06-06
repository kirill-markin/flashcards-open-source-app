import type { DatabaseExecutor } from "../database";

type GuestSessionPlatformColumnExistsRow = Readonly<{
  column_exists: boolean;
}>;

let guestSessionPlatformColumnKnownPresent = false;

export async function guestSessionPlatformColumnExistsInExecutor(
  executor: DatabaseExecutor,
): Promise<boolean> {
  if (guestSessionPlatformColumnKnownPresent) {
    return true;
  }

  const result = await executor.query<GuestSessionPlatformColumnExistsRow>(
    [
      "SELECT EXISTS (",
      "SELECT 1",
      "FROM information_schema.columns",
      "WHERE table_schema = 'auth'",
      "AND table_name = 'guest_sessions'",
      "AND column_name = 'platform'",
      ") AS column_exists",
    ].join(" "),
    [],
  );
  const columnExists = result.rows[0]?.column_exists === true;
  if (columnExists) {
    guestSessionPlatformColumnKnownPresent = true;
  }

  return columnExists;
}
