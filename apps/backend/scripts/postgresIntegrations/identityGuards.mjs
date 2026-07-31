import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  cleanupClientTeardownReserveMilliseconds,
  databaseTerminationPollMilliseconds,
  disposableDatabaseName,
  lifecycleLockKeys,
  lifecycleRecoveryPollMilliseconds,
} from "./boundaries.mjs";
import { cleanupRemainingMilliseconds } from "./errors.mjs";
import { runCleanupQuery } from "./supervisedClient.mjs";

export async function acquireLifecycleLock(adminClient) {
  const result = await adminClient.query(
    `SELECT pg_catalog.pg_try_advisory_lock($1::integer, $2::integer) AS acquired`,
    lifecycleLockKeys,
  );
  if (result.rows[0]?.acquired !== true) {
    throw new Error(
      "Another PostgreSQL integration runner already owns the cluster lifecycle lock. Use a separate isolated PostgreSQL 18 cluster or wait for that runner to finish.",
    );
  }
}

export async function reacquireLifecycleLockForCleanup(
  cleanupSession,
  cleanupDeadline,
) {
  while (true) {
    const result = await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "lifecycle lock reacquisition",
      `SELECT pg_catalog.pg_try_advisory_lock($1::integer, $2::integer) AS acquired`,
      lifecycleLockKeys,
    );
    if (result.rows[0]?.acquired === true) return;
    const remainingMilliseconds = cleanupRemainingMilliseconds(
      cleanupDeadline,
      "lifecycle lock reacquisition wait",
    );
    await delay(Math.min(
      lifecycleRecoveryPollMilliseconds,
      remainingMilliseconds,
    ));
  }
}

export async function terminateDatabaseSessionsByOid(
  cleanupSession,
  cleanupDeadline,
  databaseOid,
  phase,
) {
  const terminationResult = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    `${phase} termination signals`,
    `SELECT
       pid,
       pg_catalog.pg_terminate_backend(
         pid,
         0
       ) AS terminated
     FROM pg_catalog.pg_stat_activity
     WHERE datid = $1::oid AND pid <> pg_catalog.pg_backend_pid()
     ORDER BY pid`,
    [databaseOid],
  );
  const unsignaledSessions = terminationResult.rows
    .filter((row) => row.terminated !== true)
    .map((row) => Object.freeze({
      pid: row.pid,
      signalAccepted: row.terminated,
    }));

  let remainingPids = [];
  while (true) {
    const sessionsResult = await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      `${phase} termination polling`,
      `SELECT pid
       FROM pg_catalog.pg_stat_activity
       WHERE datid = $1::oid AND pid <> pg_catalog.pg_backend_pid()
       ORDER BY pid`,
      [databaseOid],
    );
    remainingPids = sessionsResult.rows.map((row) => row.pid);
    if (remainingPids.length === 0) break;
    const remainingMilliseconds = Math.floor(
      cleanupDeadline.expiresAt - performance.now(),
    );
    if (remainingMilliseconds <= cleanupClientTeardownReserveMilliseconds) {
      break;
    }
    await delay(Math.min(
      databaseTerminationPollMilliseconds,
      remainingMilliseconds - cleanupClientTeardownReserveMilliseconds,
    ));
  }

  if (unsignaledSessions.length > 0 || remainingPids.length > 0) {
    throw new Error(
      `PostgreSQL could not terminate every session on the exact runner-owned database OID within one shared deadline. databaseOid=${databaseOid} phase=${phase} timeoutMilliseconds=${cleanupDeadline.timeoutMilliseconds} unsignaledSessions=${JSON.stringify(unsignaledSessions)} remainingPids=${JSON.stringify(remainingPids)}`,
    );
  }
}

export function getDatabaseOwnershipEvidence(boundaryState) {
  if (
    boundaryState.pendingDatabaseOid !== null
    && boundaryState.ownedDatabaseOid !== null
  ) {
    throw new Error(
      `PostgreSQL integration database ownership state contains both pending and promoted identities. database=${disposableDatabaseName} pendingOid=${boundaryState.pendingDatabaseOid} ownedOid=${boundaryState.ownedDatabaseOid}`,
    );
  }
  if (boundaryState.ownedDatabaseOid !== null) {
    return Object.freeze({
      databaseOid: boundaryState.ownedDatabaseOid,
      ownershipState: "owned",
    });
  }
  if (boundaryState.pendingDatabaseOid !== null) {
    return Object.freeze({
      databaseOid: boundaryState.pendingDatabaseOid,
      ownershipState: "pending",
    });
  }
  return null;
}

function classifyDatabaseIdentityRows(rows, expectedDatabaseOid) {
  const namedDatabase = rows.find(
    (row) => row.datname === disposableDatabaseName,
  );
  const oidDatabase = rows.find(
    (row) => row.database_oid === expectedDatabaseOid,
  );
  const nameMatch = namedDatabase === undefined
    ? null
    : Object.freeze({
      databaseName: namedDatabase.datname,
      databaseOid: namedDatabase.database_oid,
    });
  const oidMatch = oidDatabase === undefined
    ? null
    : Object.freeze({
      databaseName: oidDatabase.datname,
      databaseOid: oidDatabase.database_oid,
    });

  let classification;
  if (nameMatch === null && oidMatch === null) {
    classification = "absent";
  } else if (
    nameMatch?.databaseOid === expectedDatabaseOid
    && oidMatch?.databaseName === disposableDatabaseName
  ) {
    classification = "exact";
  } else if (nameMatch !== null && oidMatch !== null) {
    classification = "name-and-oid-conflict";
  } else if (nameMatch !== null) {
    classification = "name-conflict";
  } else {
    classification = "oid-conflict";
  }

  return Object.freeze({
    classification,
    expectedDatabaseOid,
    nameMatch,
    oidMatch,
  });
}

export async function inspectDatabaseIdentity(adminClient, expectedDatabaseOid) {
  const result = await adminClient.query(
    `SELECT datname, oid::text AS database_oid
     FROM pg_catalog.pg_database
     WHERE datname = $1 OR oid = $2::oid
     ORDER BY datname`,
    [disposableDatabaseName, expectedDatabaseOid],
  );
  return classifyDatabaseIdentityRows(result.rows, expectedDatabaseOid);
}

export async function inspectDatabaseIdentityForCleanup(
  cleanupSession,
  cleanupDeadline,
  expectedDatabaseOid,
  phase,
) {
  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    `SELECT datname, oid::text AS database_oid
     FROM pg_catalog.pg_database
     WHERE datname = $1 OR oid = $2::oid
     ORDER BY datname`,
    [disposableDatabaseName, expectedDatabaseOid],
  );
  return classifyDatabaseIdentityRows(result.rows, expectedDatabaseOid);
}

export function databaseIdentityInterferenceError(identity, phase) {
  return new Error(
    `Refusing to claim or clean a PostgreSQL database after name/OID ownership interference. phase=${phase} expectedDatabase=${disposableDatabaseName} expectedOid=${identity.expectedDatabaseOid} classification=${identity.classification} nameMatchDatabase=${identity.nameMatch?.databaseName ?? "missing"} nameMatchOid=${identity.nameMatch?.databaseOid ?? "missing"} oidMatchDatabase=${identity.oidMatch?.databaseName ?? "missing"} oidMatchOid=${identity.oidMatch?.databaseOid ?? "missing"}`,
  );
}

export async function inspectOwnedRoleIdentities(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  phase,
) {
  const ownedRoles = [...boundaryState.ownedRoleOids.entries()];
  if (ownedRoles.length === 0) return Object.freeze([]);

  const result = await runCleanupQuery(
    cleanupSession,
    cleanupDeadline,
    phase,
    `SELECT rolname, oid::text AS role_oid
     FROM pg_catalog.pg_roles
     WHERE rolname = ANY($1::text[]) OR oid = ANY($2::oid[])
     ORDER BY rolname`,
    [
      ownedRoles.map(([roleName]) => roleName),
      ownedRoles.map(([, roleOid]) => roleOid),
    ],
  );
  return Object.freeze(ownedRoles.map(([roleName, expectedRoleOid]) => {
    const namedRole = result.rows.find((row) => row.rolname === roleName);
    const oidRole = result.rows.find(
      (row) => row.role_oid === expectedRoleOid,
    );
    const nameMatch = namedRole === undefined
      ? null
      : Object.freeze({
        roleName: namedRole.rolname,
        roleOid: namedRole.role_oid,
      });
    const oidMatch = oidRole === undefined
      ? null
      : Object.freeze({
        roleName: oidRole.rolname,
        roleOid: oidRole.role_oid,
      });

    let classification;
    if (nameMatch === null && oidMatch === null) {
      classification = "absent";
    } else if (
      nameMatch?.roleOid === expectedRoleOid
      && oidMatch?.roleName === roleName
    ) {
      classification = "exact";
    } else if (nameMatch !== null && oidMatch !== null) {
      classification = "name-and-oid-conflict";
    } else if (nameMatch !== null) {
      classification = "name-conflict";
    } else {
      classification = "oid-conflict";
    }

    return Object.freeze({
      classification,
      expectedRoleOid,
      nameMatch,
      oidMatch,
      roleName,
    });
  }));
}

export function roleIdentityInterferenceError(identity, phase) {
  return new Error(
    `Refusing to clean a PostgreSQL role after name/OID ownership interference. phase=${phase} expectedRole=${identity.roleName} expectedOid=${identity.expectedRoleOid} classification=${identity.classification} nameMatchRole=${identity.nameMatch?.roleName ?? "missing"} nameMatchOid=${identity.nameMatch?.roleOid ?? "missing"} oidMatchRole=${identity.oidMatch?.roleName ?? "missing"} oidMatchOid=${identity.oidMatch?.roleOid ?? "missing"}`,
  );
}

export async function inspectBoundaryCleanupIdentities(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
) {
  const databaseOwnership = getDatabaseOwnershipEvidence(boundaryState);
  const databaseIdentity = databaseOwnership === null
    ? null
    : await inspectDatabaseIdentityForCleanup(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "whole-boundary database identity classification",
    );
  const roleIdentities = await inspectOwnedRoleIdentities(
    cleanupSession,
    cleanupDeadline,
    boundaryState,
    "whole-boundary role identity classification",
  );
  return Object.freeze({
    databaseIdentity,
    databaseOwnership,
    roleIdentities,
  });
}

export function cleanupIdentityConflictErrors(cleanupIdentities) {
  const conflicts = [];
  if (
    cleanupIdentities.databaseIdentity !== null
    && cleanupIdentities.databaseIdentity.classification !== "exact"
    && cleanupIdentities.databaseIdentity.classification !== "absent"
  ) {
    conflicts.push(databaseIdentityInterferenceError(
      cleanupIdentities.databaseIdentity,
      "whole-boundary cleanup classification",
    ));
  }
  for (const roleIdentity of cleanupIdentities.roleIdentities) {
    if (
      roleIdentity.classification === "exact"
      || roleIdentity.classification === "absent"
    ) {
      continue;
    }
    conflicts.push(roleIdentityInterferenceError(
      roleIdentity,
      "whole-boundary cleanup classification",
    ));
  }
  return conflicts;
}
