// Postgres connection budget for the DB-backed Lambda fleet.
//
//   sum(reservedConcurrentExecutions) * databasePoolMaxConnectionsPerContainer
//     <= usableDatabaseConnections
//
// Every budgeted function states its share below, so a burst on any one route cannot take the
// database out from under the others. Without both factors the bound does not exist: an unreserved
// function scales to the account limit, and an unbounded pool multiplies each container by the pg
// default of 10. Both factors are therefore machine-enforced from here: the checks under the
// constants bound the summed reservations from above and the pool max from below at synth time, and
// every budgeted function receives databasePoolMaxConnectionsPerContainer as
// DB_POOL_MAX_CONNECTIONS, which apps/backend/src/database/core.ts and apps/auth/src/db.ts read when
// they build their pools. Do not hardcode a pool max in either application; a value set there alone
// would leave these checks passing while the guarantee silently broke.
//
// Hard guarantee. The db.t4g.small instance reports max_connections = 181 with 3 held for
// superusers, leaving 178 usable. The reservations below total 39 containers, so the worst case is
// 39 x 3 = 117 <= 178. The check under the constants enforces it at synth time.
//
// Expected steady state. A warm container holds close to one connection, not the pool ceiling. This
// is measured, not assumed: during the 2026-08-29 06:40 UTC burst BackendHandler
// ConcurrentExecutions peaked at 110 in the same minute DatabaseConnections peaked at 110, a ratio
// of about 1.1. So the expected draw here is 39 x ~1.1 ~= 43 connections, comfortably below the 62
// this instance already carries. databasePoolMaxConnectionsPerContainer is a per-container safety
// ceiling, not the expected per-container draw.
//
// Do not lower databasePoolMaxConnectionsPerContainer below
// minimumDatabasePoolMaxConnectionsPerContainer either. It is a floor, not a lever for fitting more
// containers under that ceiling: a handler that holds a transaction client from pool.connect() and
// then issues a pooled query needs at least two connections in the same container, so 1 or 2 can
// self-deadlock. Both application pools already refuse to start below the floor
// (defaultMainPoolMaxConnections in apps/backend/src/database/core.ts and
// defaultAuthPoolMaxConnections in apps/auth/src/db.ts), so lowering it here would not buy container
// headroom, it would throw on the first pool build in every DB-backed Lambda. The synth check
// enforces that direction too, so the stack cannot deploy a value the fleet cannot run.
//
// Carve-outs. Two real draws on this database sit outside the factor above and are covered by
// headroom rather than by budget, so 117 is this budget's ceiling and not the whole fleet's:
//
//   Secondary pools. A backend container may additionally open the session advisory lock pool
//   (max: 2), the product analytics writer pool (max: 4), and the reporting pool (max: 4). Each is
//   separately bounded where it is created.
//
//   Unreserved scheduled jobs. WebGuestReaperHandler, CommunityLeaderboardSnapshotHandler,
//   StreakLeaderboardSnapshotHandler, ProgressActiveDaysBackfillHandler,
//   MultipartCompletionReconciliationHandler and GeneratedMediaPromotionHandler bundle the same
//   backend code and receive DB_SECRET_ARN, so they open this same main pool with no reservation of
//   their own. They stay out of the budget deliberately: each is cron-driven and effectively
//   serialized at roughly one container, a small and predictable draw rather than a burst source.
//   (CatalogDumpHandler already pins reservedConcurrentExecutions to 1. GlobalMetricsSnapshotHandler
//   and its freshness checker draw on the reporting pool only, and DbMigrationHandler connects with
//   its own owner credentials, so neither touches this pool.)
//
// The honest worst case is therefore 117 from the budget plus those carve-outs, not 117 flat, and
// the 178 - 117 = 61 left over covers them comfortably.
//
// Once a reservation saturates, Lambda throttles and the caller sees a gateway error. That bounded,
// observable rejection is the intended trade against an unbounded database outage.
//
// Sizing comes from observed ConcurrentExecutions, not from dividing the budget across handlers,
// so each reservation sits above that handler's observed demand.
const databasePoolMaxConnectionsPerContainer = 3;
// The floor described above. Deliberately not shared with the applications: neither runtime can
// import this file, so each keeps its own copy where it builds its pool and this one exists to stop
// an unrunnable value from being synthesized in the first place.
const minimumDatabasePoolMaxConnectionsPerContainer = 3;
const usableDatabaseConnections = 178;
// Read by apps/backend/src/database/core.ts and apps/auth/src/db.ts when they build their pools.
// Set it on every function that opens one of those pools and carries a reservation above.
export const databasePoolMaxConnectionsEnvName = "DB_POOL_MAX_CONNECTIONS";
export const databasePoolMaxConnectionsEnvValue = String(databasePoolMaxConnectionsPerContainer);
// Observed p50/p95/max 1/4/110, where the 110 max was the catalog media fan-out that the CDN work
// removes. 2x p95.
export const backendHandlerReservedConcurrency = 8;
// Observed 1/3/19. 2x p95.
export const authHandlerReservedConcurrency = 6;
// Observed 1/1/9. 4x p95.
export const mcpHandlerReservedConcurrency = 4;
// Production reached the previous cap of 10 on 2026-09-02, with two same-minute throttles and 40
// throttles through 05:04 UTC. A reservation of 16 gives round headroom above at least 12
// simultaneous attempts. SSE holds a container for the whole stream, so concurrency here is set by
// session duration rather than by requests per second.
export const chatLiveHandlerReservedConcurrency = 16;
// Observed 1/1/2, sized above the weekly max. A run holds a container up to 720 s, under the shared
// 15-minute timeout, so the same duration-driven reasoning applies.
export const chatRunWorkerHandlerReservedConcurrency = 3;
// Observed 1/1/2. At the weekly max.
export const directImageIngestionHandlerReservedConcurrency = 2;

const budgetedDatabaseConnections = [
  backendHandlerReservedConcurrency,
  authHandlerReservedConcurrency,
  mcpHandlerReservedConcurrency,
  chatLiveHandlerReservedConcurrency,
  chatRunWorkerHandlerReservedConcurrency,
  directImageIngestionHandlerReservedConcurrency,
].reduce((total, reserved) => total + reserved, 0) * databasePoolMaxConnectionsPerContainer;

if (databasePoolMaxConnectionsPerContainer < minimumDatabasePoolMaxConnectionsPerContainer) {
  throw new Error(
    "Per-container Postgres pool max is below the floor both application pools enforce, so every "
      + "DB-backed Lambda would throw on its first pool build. Keep it at or above the floor; if "
      + "the floor itself ever moves, change defaultMainPoolMaxConnections in "
      + "apps/backend/src/database/core.ts and defaultAuthPoolMaxConnections in "
      + "apps/auth/src/db.ts in the same change. "
      + `configured=${databasePoolMaxConnectionsPerContainer}; `
      + `floor=${minimumDatabasePoolMaxConnectionsPerContainer}`,
  );
}

if (budgetedDatabaseConnections > usableDatabaseConnections) {
  throw new Error(
    "DB-backed Lambda concurrency exceeds the usable Postgres connection budget. "
      + `budgeted=${budgetedDatabaseConnections}; `
      + `usable=${usableDatabaseConnections}`,
  );
}
