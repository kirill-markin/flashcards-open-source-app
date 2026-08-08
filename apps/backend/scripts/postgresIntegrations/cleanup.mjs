import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import pgUtils from "pg/lib/utils.js";
import {
  cleanupClientTeardownReserveMilliseconds,
  databaseOidMinimum,
  databaseOidSelectionMaximumAttempts,
  disposableDatabaseName,
  lifecycleCleanupMaximumAttempts,
} from "./boundaries.mjs";
import { combineErrors, contextualError } from "./errors.mjs";
import { runCleanupQuery } from "./supervisedClient.mjs";
import {
  cleanupIdentityConflictErrors,
  databaseIdentityInterferenceError,
  getDatabaseOwnershipEvidence,
  inspectBoundaryCleanupIdentities,
  inspectDatabaseIdentity,
  inspectDatabaseIdentityForCleanup,
  inspectOwnedRoleIdentities,
  roleIdentityInterferenceError,
  terminateDatabaseSessionsByOid,
} from "./identityGuards.mjs";

const { escapeIdentifier } = pgUtils;

async function selectUnusedDatabaseOid(adminClient) {
  for (
    let attempt = 1;
    attempt <= databaseOidSelectionMaximumAttempts;
    attempt += 1
  ) {
    const candidate = randomBytes(4).readUInt32BE(0);
    if (candidate < databaseOidMinimum) continue;
    const candidateOid = String(candidate);
    const result = await adminClient.query(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_database
         WHERE oid = $1::oid
       ) AS available`,
      [candidateOid],
    );
    if (result.rows[0]?.available === true) return candidateOid;
  }
  throw new Error(
    `PostgreSQL integration could not select an unused database OID after bounded catalog checks. attempts=${databaseOidSelectionMaximumAttempts}`,
  );
}

export async function createDisposableDatabase(adminClient, boundaryState) {
  if (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid !== null
  ) {
    throw new Error(
      `PostgreSQL integration database ownership state is not empty before creation. database=${disposableDatabaseName} pendingOid=${boundaryState.pendingDatabaseOid ?? "none"} ownedOid=${boundaryState.ownedDatabaseOid ?? "none"}`,
    );
  }
  const databaseOid = await selectUnusedDatabaseOid(adminClient);
  boundaryState.pendingDatabaseOid = databaseOid;
  await adminClient.query(
    `CREATE DATABASE ${escapeIdentifier(disposableDatabaseName)} WITH OID = ${databaseOid}`,
  );
  boundaryState.ownedDatabaseOid = databaseOid;
  boundaryState.pendingDatabaseOid = null;
}

export function requireOwnedDatabaseOidForWork(boundaryState, phase) {
  if (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid === null
  ) {
    throw new Error(
      `PostgreSQL integration cannot start database work without one promoted exact database identity. phase=${phase} pendingDatabaseOid=${boundaryState.pendingDatabaseOid ?? "missing"} ownedDatabaseOid=${boundaryState.ownedDatabaseOid ?? "missing"}`,
    );
  }
  return boundaryState.ownedDatabaseOid;
}

export async function requireOwnedDatabaseIdentityForWork(
  adminClient,
  boundaryState,
  phase,
) {
  const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
    boundaryState,
    phase,
  );
  const identity = await inspectDatabaseIdentity(
    adminClient,
    expectedDatabaseOid,
  );
  if (identity.classification !== "exact") {
    throw databaseIdentityInterferenceError(
      identity,
      phase,
    );
  }
}

export async function requireConnectedDatabaseIdentityForWork(
  client,
  boundaryState,
  phase,
) {
  const expectedDatabaseOid = requireOwnedDatabaseOidForWork(
    boundaryState,
    phase,
  );
  const result = await client.query(
    `SELECT
       current_database() AS database_name,
       database.oid::text AS database_oid
     FROM pg_catalog.pg_database AS database
     WHERE database.datname = current_database()`,
  );
  const actualDatabase = result.rows[0];
  if (
    actualDatabase?.database_name !== disposableDatabaseName
    || actualDatabase.database_oid !== expectedDatabaseOid
  ) {
    throw new Error(
      `Refusing PostgreSQL integration work on a database connection without the exact runner-owned identity. phase=${phase} expectedDatabase=${disposableDatabaseName} expectedOid=${expectedDatabaseOid} actualDatabase=${actualDatabase?.database_name ?? "missing"} actualOid=${actualDatabase?.database_oid ?? "missing"}`,
    );
  }
}

function clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership) {
  if (databaseOwnership.ownershipState === "pending") {
    if (boundaryState.pendingDatabaseOid !== databaseOwnership.databaseOid) {
      throw new Error(
        `PostgreSQL integration pending database ownership changed during cleanup. expectedOid=${databaseOwnership.databaseOid} actualOid=${boundaryState.pendingDatabaseOid ?? "missing"}`,
      );
    }
    boundaryState.pendingDatabaseOid = null;
    return;
  }
  if (databaseOwnership.ownershipState === "owned") {
    if (boundaryState.ownedDatabaseOid !== databaseOwnership.databaseOid) {
      throw new Error(
        `PostgreSQL integration promoted database ownership changed during cleanup. expectedOid=${databaseOwnership.databaseOid} actualOid=${boundaryState.ownedDatabaseOid ?? "missing"}`,
      );
    }
    boundaryState.ownedDatabaseOid = null;
    return;
  }
  throw new Error(
    `PostgreSQL integration database ownership state is unsupported during cleanup. ownershipState=${databaseOwnership.ownershipState}`,
  );
}

async function cleanupDisposableDatabase(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  cleanupIdentities,
) {
  const errors = [];
  const { databaseIdentity, databaseOwnership } = cleanupIdentities;
  if (databaseIdentity === null || databaseOwnership === null) return errors;
  if (databaseIdentity.classification === "absent") {
    clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
    return errors;
  }
  if (databaseIdentity.classification !== "exact") {
    throw new Error(
      `PostgreSQL integration reached database cleanup with an unapproved identity classification. classification=${databaseIdentity.classification} databaseOid=${databaseOwnership.databaseOid}`,
    );
  }

  let sessionsClosed = false;
  try {
    await terminateDatabaseSessionsByOid(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "runner-owned database cleanup",
    );
    sessionsClosed = true;
  } catch (error) {
    errors.push(contextualError(
      `Failed to terminate and await connections to the runner-owned PostgreSQL database. database=${disposableDatabaseName}`,
      error,
    ));
  }

  if (!sessionsClosed) return errors;
  try {
    const currentIdentity = await inspectDatabaseIdentityForCleanup(
      cleanupSession,
      cleanupDeadline,
      databaseOwnership.databaseOid,
      "final database cleanup identity verification",
    );
    if (currentIdentity.classification === "absent") {
      clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
      return errors;
    }
    if (currentIdentity.classification !== "exact") {
      throw databaseIdentityInterferenceError(
        currentIdentity,
        "final database cleanup verification",
      );
    }
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned database drop",
      `DROP DATABASE ${escapeIdentifier(disposableDatabaseName)} WITH (FORCE)`,
      [],
    );
    clearDatabaseOwnershipEvidence(boundaryState, databaseOwnership);
  } catch (error) {
    errors.push(contextualError(
      `Failed to drop the runner-owned PostgreSQL database. database=${disposableDatabaseName} databaseOid=${databaseOwnership.databaseOid} exact ownership evidence was retained because a DDL timeout or connection loss can make the outcome ambiguous; reclassify the exact name/OID before manual follow-up`,
      error,
    ));
  }
  return errors;
}

async function cleanupOwnedRoles(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  classifiedRoleIdentities,
) {
  if (classifiedRoleIdentities.length === 0) return [];

  let transactionStarted = false;
  let primaryError = null;
  const finalizationErrors = [];
  let currentRoleIdentities = [];
  try {
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned role cleanup transaction begin",
      "BEGIN",
      [],
    );
    transactionStarted = true;
    currentRoleIdentities = await inspectOwnedRoleIdentities(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      "transactional role cleanup identity verification",
    );
    const conflicts = currentRoleIdentities
      .filter((identity) => (
        identity.classification !== "exact"
        && identity.classification !== "absent"
      ))
      .map((identity) => roleIdentityInterferenceError(
        identity,
        "transactional role cleanup verification",
      ));
    if (conflicts.length > 0) {
      throw new AggregateError(
        conflicts,
        "Refusing to mutate any tracked PostgreSQL role because cleanup identity verification found conflicts.",
      );
    }
    const exactRoles = currentRoleIdentities
      .filter((identity) => identity.classification === "exact")
      .reverse();
    for (const roleIdentity of exactRoles) {
      await runCleanupQuery(
        cleanupSession,
        cleanupDeadline,
        `runner-owned role drop role=${roleIdentity.roleName} roleOid=${roleIdentity.expectedRoleOid}`,
        `DROP ROLE ${escapeIdentifier(roleIdentity.roleName)}`,
        [],
      );
    }
    await runCleanupQuery(
      cleanupSession,
      cleanupDeadline,
      "runner-owned role cleanup transaction commit",
      "COMMIT",
      [],
    );
    transactionStarted = false;
  } catch (error) {
    primaryError = contextualError(
      `Failed to transactionally clean runner-owned PostgreSQL roles. exact ownership evidence was retained because a DDL or commit timeout can make the outcome ambiguous; reclassify every exact name/OID before manual follow-up. trackedRoles=${JSON.stringify([...boundaryState.ownedRoleOids.entries()])}`,
      error,
    );
  }

  if (transactionStarted) {
    try {
      await runCleanupQuery(
        cleanupSession,
        cleanupDeadline,
        "runner-owned role cleanup transaction rollback",
        "ROLLBACK",
        [],
      );
    } catch (error) {
      finalizationErrors.push(contextualError(
        "Failed to roll back transactional PostgreSQL role cleanup.",
        error,
      ));
    }
  }
  const failure = combineErrors(
    [
      ...(primaryError === null ? [] : [primaryError]),
      ...finalizationErrors,
    ],
    "PostgreSQL role cleanup and rollback failed.",
  );
  if (failure !== null) return [failure];

  for (const roleIdentity of currentRoleIdentities) {
    boundaryState.ownedRoleOids.delete(roleIdentity.roleName);
  }
  return [];
}

async function cleanupBoundaryState(
  cleanupSession,
  cleanupDeadline,
  boundaryState,
  boundaryFileName,
) {
  let cleanupIdentities;
  try {
    cleanupIdentities = await inspectBoundaryCleanupIdentities(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
    );
  } catch (error) {
    return [contextualError(
      `Failed to classify all tracked PostgreSQL identities before cleanup. boundary=${boundaryFileName}`,
      error,
    )];
  }
  const identityConflicts = cleanupIdentityConflictErrors(cleanupIdentities);
  if (identityConflicts.length > 0) {
    return [new AggregateError(
      identityConflicts,
      `Refusing to mutate any runner-tracked PostgreSQL object because whole-boundary cleanup classification found conflicts. boundary=${boundaryFileName} pendingDatabaseOid=${boundaryState.pendingDatabaseOid ?? "missing"} ownedDatabaseOid=${boundaryState.ownedDatabaseOid ?? "missing"} ownedRoles=${JSON.stringify([...boundaryState.ownedRoleOids.entries()])}`,
    )];
  }

  const errors = await cleanupDisposableDatabase(
    cleanupSession,
    cleanupDeadline,
    boundaryState,
    cleanupIdentities,
  );
  if (errors.length === 0) {
    errors.push(...await cleanupOwnedRoles(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      cleanupIdentities.roleIdentities,
    ));
  }
  const remainingState = [];
  if (boundaryState.pendingDatabaseOid !== null) {
    remainingState.push(
      `pendingDatabase=${disposableDatabaseName} databaseOid=${boundaryState.pendingDatabaseOid}`,
    );
  }
  if (boundaryState.ownedDatabaseOid !== null) {
    remainingState.push(
      `database=${disposableDatabaseName} databaseOid=${boundaryState.ownedDatabaseOid}`,
    );
  }
  if (boundaryState.ownedRoleOids.size > 0) {
    remainingState.push(
      `roles=${JSON.stringify([...boundaryState.ownedRoleOids.keys()])}`,
    );
  }
  if (remainingState.length > 0) {
    errors.push(new Error(
      `PostgreSQL integration cleanup retained runner-owned state. boundary=${boundaryFileName} ${remainingState.join(" ")}`,
    ));
  }
  return errors;
}

function boundaryStateHasOwnedObjects(boundaryState) {
  return (
    boundaryState.pendingDatabaseOid !== null
    || boundaryState.ownedDatabaseOid !== null
    || boundaryState.ownedRoleOids.size > 0
  );
}

export async function cleanupBoundaryStateWithRecovery(
  lifecycleAdminSession,
  boundaryState,
  boundaryFileName,
  cleanupDeadline,
) {
  const errors = [];
  for (
    let attempt = 1;
    attempt <= lifecycleCleanupMaximumAttempts;
    attempt += 1
  ) {
    let cleanupSession;
    try {
      const databaseOwnership = getDatabaseOwnershipEvidence(boundaryState);
      cleanupSession = await lifecycleAdminSession.getClientForCleanup(
        databaseOwnership,
        cleanupDeadline,
      );
    } catch (error) {
      errors.push(contextualError(
        `PostgreSQL integration could not obtain a serialized administrative session for cleanup. boundary=${boundaryFileName} attempt=${attempt}`,
        error,
      ));
      if (
        attempt < lifecycleCleanupMaximumAttempts
        && cleanupDeadline.expiresAt - performance.now()
          > cleanupClientTeardownReserveMilliseconds
      ) {
        continue;
      }
      break;
    }
    errors.push(...await cleanupBoundaryState(
      cleanupSession,
      cleanupDeadline,
      boundaryState,
      boundaryFileName,
    ));
    if (!boundaryStateHasOwnedObjects(boundaryState)) break;
    if (lifecycleAdminSession.isCleanupClientHealthy()) break;
    if (
      cleanupDeadline.expiresAt - performance.now()
      <= cleanupClientTeardownReserveMilliseconds
    ) {
      break;
    }
  }
  return errors;
}

