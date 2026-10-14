import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { unsafeTransaction } from "../../database/unsafe";
import { linkProvedCognitoPrincipalInExecutor } from "../../auth/userIdentities";
import { ensureCognitoUserProfile } from "../../auth/ensureUser";
import { updateAccountPreferences } from "../../routes/system/account/accountPreferences";
import { parseAccountPreferencesInput } from "../../routes/system/support";
import { HttpError } from "../../shared/errors";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  createGuestSession,
  prepareGuestUpgrade,
} from "..";

/**
 * A guest session whose user is already bound to a Cognito subject is that account's, run against
 * real PostgreSQL: the guest transport stops accepting it after the binding's grace period, and the
 * upgrade routes refuse to bind a second subject to it or merge it into another account, while the
 * owning subject's own bound upgrade keeps working.
 */
const UPGRADE_CAPABILITIES = {
  guestWorkspaceSyncedAndOutboxDrained: true,
  requiresGuestWorkspaceSyncedAndOutboxDrained: true,
  supportsDroppedEntities: true,
} as const;

function requireOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the bound guest session PostgreSQL integration test.",
    );
  }

  return databaseUrl;
}

async function bindGuestUser(
  ownerPool: pg.Pool,
  guestUserId: string,
  mappingAge: string,
): Promise<void> {
  await ownerPool.query(
    [
      "INSERT INTO auth.user_identities (provider_type, provider_subject, user_id, created_at)",
      "VALUES ('cognito', $1, $2, now() - $3::interval)",
    ].join(" "),
    [randomUUID(), guestUserId, mappingAge],
  );
}

async function readMappedUserIds(
  ownerPool: pg.Pool,
  providerSubject: string,
): Promise<ReadonlyArray<string>> {
  const result = await ownerPool.query<Readonly<{ user_id: string }>>(
    "SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito' AND provider_subject = $1",
    [providerSubject],
  );

  return result.rows.map((row) => row.user_id);
}

type GuestAccountState = Readonly<{
  userSettingsRows: number;
  workspaceRows: number;
  liveGuestSessionRows: number;
}>;

async function readGuestAccountState(
  ownerPool: pg.Pool,
  userId: string,
  workspaceId: string,
): Promise<GuestAccountState> {
  const result = await ownerPool.query<Readonly<{
    user_settings_rows: number;
    workspace_rows: number;
    live_guest_session_rows: number;
  }>>(
    [
      "SELECT",
      "(SELECT count(*)::integer FROM org.user_settings WHERE user_id = $1) AS user_settings_rows,",
      "(SELECT count(*)::integer FROM org.workspaces WHERE workspace_id = $2::uuid) AS workspace_rows,",
      "(SELECT count(*)::integer FROM auth.guest_sessions WHERE user_id = $1 AND revoked_at IS NULL)",
      "AS live_guest_session_rows",
    ].join(" "),
    [userId, workspaceId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Guest account state query returned no row for user ${userId}.`);
  }

  return {
    userSettingsRows: row.user_settings_rows,
    workspaceRows: row.workspace_rows,
    liveGuestSessionRows: row.live_guest_session_rows,
  };
}

async function removeAccounts(
  ownerPool: pg.Pool,
  userIds: ReadonlyArray<string>,
  workspaceIds: ReadonlyArray<string>,
): Promise<void> {
  await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [
    [...workspaceIds],
  ]);
  // auth.guest_sessions and auth.user_identities cascade from here.
  await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [
    [...userIds],
  ]);
}

function isGuestAuthInvalid(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 401 && error.code === "GUEST_AUTH_INVALID";
}

test("the guest transport refuses a session bound past the grace period and accepts a recent or unbound one", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "bound-guest-session-integration-owner",
  });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];

  try {
    const longBound = await createGuestSession("ios", null);
    const recentlyBound = await createGuestSession("android", null);
    const unbound = await createGuestSession("ios", null);
    for (const guest of [longBound, recentlyBound, unbound]) {
      userIds.push(guest.userId);
      workspaceIds.push(guest.workspaceId);
    }
    await bindGuestUser(ownerPool, longBound.userId, "8 days");
    await bindGuestUser(ownerPool, recentlyBound.userId, "1 hour");

    await assert.rejects(authenticateGuestSession(longBound.guestToken), isGuestAuthInvalid);
    assert.equal((await authenticateGuestSession(recentlyBound.guestToken)).userId, recentlyBound.userId);
    assert.equal((await authenticateGuestSession(unbound.guestToken)).userId, unbound.userId);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

test("a bound guest refuses a second subject and a merge into another account, and still completes for its owner", async () => {
  const ownerPool = new pg.Pool({
    connectionString: requireOwnerDatabaseUrl(),
    application_name: "bound-guest-session-integration-owner",
  });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  const ownerSubject = randomUUID();
  const secondSubject = randomUUID();
  const otherAccountSubject = randomUUID();

  try {
    const guest = await createGuestSession("ios", null);
    userIds.push(guest.userId);
    workspaceIds.push(guest.workspaceId);
    const otherAccount = await ensureCognitoUserProfile(
      otherAccountSubject,
      `bound-guest-other-${randomUUID()}@example.com`,
    );
    userIds.push(otherAccount.userId);
    const otherWorkspaceId = otherAccount.selectedWorkspaceId;
    if (otherWorkspaceId === null) {
      throw new Error(`Account ${otherAccount.userId} was provisioned without a selected workspace.`);
    }
    workspaceIds.push(otherWorkspaceId);

    await updateAccountPreferences(guest.userId, parseAccountPreferencesInput({ accentColor: "#2dd4bf" }));

    const preparation = await prepareGuestUpgrade(
      guest.guestToken,
      ownerSubject,
      `bound-guest-owner-${randomUUID()}@example.com`,
    );
    assert.equal(preparation.mode, "bound");
    const boundState = await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId);
    assert.deepEqual(boundState, { userSettingsRows: 1, workspaceRows: 1, liveGuestSessionRows: 1 });

    // The leftover token must not bind a second email to the account it now is.
    await assert.rejects(
      prepareGuestUpgrade(
        guest.guestToken,
        secondSubject,
        `bound-guest-second-${randomUUID()}@example.com`,
      ),
      isGuestAuthInvalid,
    );
    assert.deepEqual(await readMappedUserIds(ownerPool, secondSubject), []);

    // Nor may a different signed-in account merge it away: the merge ends by deleting the source user.
    await assert.rejects(
      prepareGuestUpgrade(
        guest.guestToken,
        otherAccountSubject,
        `bound-guest-other-${randomUUID()}@example.com`,
      ),
      isGuestAuthInvalid,
    );
    await assert.rejects(
      completeGuestUpgrade(
        guest.guestToken,
        otherAccountSubject,
        { type: "existing", workspaceId: otherWorkspaceId },
        UPGRADE_CAPABILITIES,
      ),
      isGuestAuthInvalid,
    );
    assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), boundState);
    assert.deepEqual(await readMappedUserIds(ownerPool, ownerSubject), [guest.userId]);

    // The owning subject's own bound upgrade is untouched by both refusals.
    const retriedPreparation = await prepareGuestUpgrade(
      guest.guestToken,
      ownerSubject,
      `bound-guest-owner-${randomUUID()}@example.com`,
    );
    assert.equal(retriedPreparation.mode, "bound");
    const completion = await completeGuestUpgrade(
      guest.guestToken,
      ownerSubject,
      { type: "existing", workspaceId: guest.workspaceId },
      UPGRADE_CAPABILITIES,
    );
    assert.equal(completion.targetUserId, guest.userId);
    assert.equal(completion.targetWorkspaceId, guest.workspaceId);
    assert.equal((await ensureCognitoUserProfile(ownerSubject, null)).preferences.accentColor, "#2DD4BF");
    assert.equal((await authenticateGuestSession(guest.guestToken)).userId, guest.userId);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

test("guest merge adopts a guest accent only for a default destination and preserves it on replay", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  try {
    for (const targetColor of ["#C44B2D", "#4D8DFF"]) {
      const guest = await createGuestSession("android", null);
      userIds.push(guest.userId);
      workspaceIds.push(guest.workspaceId);
      const subject = randomUUID();
      const target = await ensureCognitoUserProfile(subject, null);
      userIds.push(target.userId);
      const targetWorkspaceId = target.selectedWorkspaceId;
      assert.notEqual(targetWorkspaceId, null);
      if (targetWorkspaceId === null) {
        throw new Error(`Account ${target.userId} has no workspace.`);
      }
      workspaceIds.push(targetWorkspaceId);
      await updateAccountPreferences(guest.userId, parseAccountPreferencesInput({ accentColor: "#F472B6" }));
      await updateAccountPreferences(target.userId, parseAccountPreferencesInput({ accentColor: targetColor }));
      assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "merge_required");
      const selection = { type: "existing", workspaceId: targetWorkspaceId } as const;
      await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      const expectedColor = targetColor === "#C44B2D" ? "#F472B6" : targetColor;
      assert.equal((await ensureCognitoUserProfile(subject, null)).preferences.accentColor, expectedColor);

      await updateAccountPreferences(target.userId, parseAccountPreferencesInput({ accentColor: "#EAB308" }));
      const replay = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      assert.equal(replay.outcome, "idempotent_replay");
      assert.equal((await ensureCognitoUserProfile(subject, null)).preferences.accentColor, "#EAB308");
    }
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

test("an unprovisioned provider principal binds a legacy native guest without a second account", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const subject = randomUUID();
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  try {
    await unsafeTransaction(async (executor) => {
      await executor.query("SELECT auth.register_cognito_principal($1, $2)", [subject, subject]);
      await executor.query("SELECT auth.bind_provider_identity('google', $1, $2)", [subject, subject]);
    });
    const before = await ownerPool.query("SELECT user_id FROM org.user_settings WHERE user_id = $1", [subject]);
    assert.equal(before.rowCount, 0);
    assert.deepEqual(await readMappedUserIds(ownerPool, subject), []);
    const guest = await createGuestSession(null, null);
    userIds.push(guest.userId);
    workspaceIds.push(guest.workspaceId);
    assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "bound");
    const complete = await completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: guest.workspaceId }, UPGRADE_CAPABILITIES);
    assert.equal(complete.targetUserId, guest.userId);
    assert.equal((await ensureCognitoUserProfile(subject, null)).userId, guest.userId);
    assert.deepEqual(await readMappedUserIds(ownerPool, subject), [guest.userId]);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
      await ownerPool.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [subject]);
    } finally { await ownerPool.end(); }
  }
});

test("committed guest merge replays through another proved principal of the same account", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const subject = randomUUID();
  const alias = randomUUID();
  const unrelated = randomUUID();
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  let guestSessionId: string | null = null;
  try {
    const account = await ensureCognitoUserProfile(subject, null);
    const other = await ensureCognitoUserProfile(unrelated, null);
    userIds.push(account.userId, other.userId);
    if (account.selectedWorkspaceId === null) throw new Error("Expected a target workspace.");
    for (const profile of [account, other]) {
      if (profile.selectedWorkspaceId !== null) workspaceIds.push(profile.selectedWorkspaceId);
    }
    const guest = await createGuestSession("android", null);
    userIds.push(guest.userId);
    workspaceIds.push(guest.workspaceId);
    assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "merge_required");
    const selection = { type: "existing", workspaceId: account.selectedWorkspaceId } as const;
    const first = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    guestSessionId = first.guestSessionId;
    await unsafeTransaction(async (executor) => {
      await executor.query("SELECT auth.register_cognito_principal($1, $2)", [alias, alias]);
    });
    await unsafeTransaction(async (executor) => {
      await linkProvedCognitoPrincipalInExecutor(executor, subject, alias);
    });
    const replay = await completeGuestUpgrade(guest.guestToken, alias, selection, UPGRADE_CAPABILITIES);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.equal(replay.targetUserId, first.targetUserId);
    assert.equal(replay.targetWorkspaceId, first.targetWorkspaceId);
    assert.equal(replay.targetSubjectUserId, alias);
    await assert.rejects(completeGuestUpgrade(guest.guestToken, unrelated, selection, UPGRADE_CAPABILITIES), isGuestAuthInvalid);
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
      await ownerPool.query("DELETE FROM auth.guest_upgrade_history WHERE source_guest_session_id = $1", [guestSessionId]);
      await ownerPool.query("DELETE FROM auth.cognito_principals WHERE cognito_subject = $1", [alias]);
    } finally { await ownerPool.end(); }
  }
});
