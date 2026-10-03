// Reservation-based accounting for the six main application pools below. The synth guard does
// not bound all connections to Postgres: secondary pools, other functions and idle connections in
// retained Lambda environments also draw from the database.
//
// The db.t4g.small instance has 181 connections, with 3 reserved for superusers: 178 usable.
// Main-pool allocation: (8 + 6 + 16 + 16 + 3 + 2) x 3 = 153, leaving 25 for additional draw.
// Every budgeted function receives DB_POOL_MAX_CONNECTIONS from here; the backend and auth pool
// constructors enforce it in apps/backend/src/database/core.ts and apps/auth/src/db.ts.
//
// Additional draw is not included in the synth guard:
// - Secondary pools: session advisory locks (max 2), product analytics (max 4), and reporting
//   (max 4) per environment that opens them. MCP sql_execute and submit_review reach the analytics
//   writer after the main transaction commits; releasing that client does not close its connection.
// - WebGuestReaperHandler, CommunityLeaderboardSnapshotHandler, StreakLeaderboardSnapshotHandler,
//   ProgressActiveDaysBackfillHandler, MultipartCompletionReconciliationHandler and
//   GeneratedMediaPromotionHandler use the main pool without reserved concurrency. Schedules are
//   not serialization: the two media jobs run every minute with two-minute timeouts, and retries
//   or additional invocations can overlap. The reaper and active-days backfill also use reporting.
// - CatalogDumpHandler has reservation 1 but its main pool is outside this sum.
//   GlobalMetricsSnapshotHandler uses reporting; its freshness checker reads S3, not Postgres.
//   DbMigrationHandler uses a separate owner connection.
//
// The remaining 25 connections do not cover simultaneous saturation of these additional pools.
// Reservation increases require observed database headroom and post-deploy monitoring; they do
// not guarantee a whole-fleet worst case or eliminate throttling when demand exceeds a reservation.
const databasePoolMaxConnectionsPerContainer = 3;
// Transactions can hold a client while nested work needs other clients. Both application pools
// enforce this floor; reducing it to fit more concurrency can deadlock handlers or fail pool startup.
const minimumDatabasePoolMaxConnectionsPerContainer = 3;
const usableDatabaseConnections = 178;
export const databasePoolMaxConnectionsEnvName = "DB_POOL_MAX_CONNECTIONS";
export const databasePoolMaxConnectionsEnvValue = String(databasePoolMaxConnectionsPerContainer);
export const backendHandlerReservedConcurrency = 8;
export const authHandlerReservedConcurrency = 6;
export const mcpHandlerReservedConcurrency = 16;
// SSE holds a container for the whole stream, so concurrency depends on session duration.
export const chatLiveHandlerReservedConcurrency = 16;
export const chatRunWorkerHandlerReservedConcurrency = 3;
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
