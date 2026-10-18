import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { unsafeTransaction } from "../../database/unsafe";
import { applyWorkspaceDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import { upsertCardSnapshotInExecutor, submitReview, type CardSnapshotInput } from "../../cards";
import { ensureWorkspaceReplicaInExecutor } from "../../sync/identity/replica";
import { createBrowserGuestSession } from "../browser/session";
import { linkProvedCognitoPrincipalInExecutor } from "../../auth/userIdentities";
import { ensureCognitoUserProfile } from "../../auth/ensureUser";
import { createWorkspaceInExecutor } from "../../workspaces/create";
import {
  loadDemoOnlyDestinationWorkspaceIdInExecutor,
  loadGuestDemoOnlyCardInExecutor,
} from "../store/demoOnly";
import { updateAccountPreferences } from "../../routes/system/account/accountPreferences";
import { parseAccountPreferencesInput } from "../../routes/system/support";
import { HttpError } from "../../shared/errors";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  completeBrowserGuestUpgrade,
  prepareBrowserGuestUpgrade,
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
    for (const targetColor of ["#FF6719", "#4D8DFF", "#C44B2D"]) {
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
      const expectedColor = targetColor === "#FF6719" ? "#F472B6" : targetColor;
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

type DemoUpgradeFixture = Readonly<{
  ownerPool: pg.Pool;
  guest: Awaited<ReturnType<typeof createGuestSession>>;
  subject: string;
  targetUserId: string;
  targetWorkspaceId: string;
  replicaId: string;
  snapshot: CardSnapshotInput;
}>;

async function withGuestUpgradeFixture(
  createSession: () => Promise<Awaited<ReturnType<typeof createGuestSession>>>,
  callback: (fixture: DemoUpgradeFixture) => Promise<void>,
): Promise<void> {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  try {
    const guest = await createSession();
    userIds.push(guest.userId);
    workspaceIds.push(guest.workspaceId);
    const subject = randomUUID();
    const target = await ensureCognitoUserProfile(subject, null);
    userIds.push(target.userId);
    if (target.selectedWorkspaceId === null) throw new Error("Expected an existing target workspace.");
    workspaceIds.push(target.selectedWorkspaceId);
    if (guest.platform === null) throw new Error("Expected a declared guest platform.");
    const platform = guest.platform;
    const createdAt = new Date().toISOString();
    const snapshot: CardSnapshotInput = {
      cardId: randomUUID(), frontText: "Seed question in its original language", backText: "Seed answer",
      cardType: "basic", tags: ["demo"],
      metadata: {
        version: 1, source: null,
        onboardingDemo: {
          version: 1, frontText: "Seed question in its original language", backText: "Seed answer",
          cardType: "basic", tags: ["demo"], wasEdited: false,
        },
      },
      createdAt, dueAt: null, reps: 0, lapses: 0, fsrsCardState: "new",
      fsrsStepIndex: null, fsrsStability: null, fsrsDifficulty: null,
      fsrsLastReviewedAt: null, fsrsScheduledDays: null, deletedAt: null,
    };
    const replicaId = await unsafeTransaction(async (executor) => {
      const replica = await ensureWorkspaceReplicaInExecutor(executor, {
        workspaceId: guest.workspaceId, userId: guest.userId, installationId: randomUUID(),
        platform, appVersion: "postgres-integration", osName: null, deviceType: null, isAutomation: true,
      });
      await upsertCardSnapshotInExecutor(executor, guest.workspaceId, snapshot, {
        clientUpdatedAt: createdAt, lastModifiedByReplicaId: replica, lastOperationId: randomUUID(),
      });
      return replica;
    });
    await callback({
      ownerPool, guest, subject, targetUserId: target.userId,
      targetWorkspaceId: target.selectedWorkspaceId, replicaId, snapshot,
    });
  } finally {
    try {
      await ownerPool.query("DELETE FROM auth.guest_upgrade_history WHERE source_guest_user_id = ANY($1::text[])", [userIds]);
      await removeAccounts(ownerPool, userIds, workspaceIds);
    } finally { await ownerPool.end(); }
  }
}

function withDemoUpgradeFixture(callback: (fixture: DemoUpgradeFixture) => Promise<void>): Promise<void> {
  return withGuestUpgradeFixture(() => createGuestSession("ios", null), callback);
}

async function reviewDemoInFixture(fixture: DemoUpgradeFixture): Promise<string> {
  const reviewEventId = randomUUID();
  const reviewedAt = new Date(Date.now() + 1_000).toISOString();
  await submitReview(fixture.guest.userId, fixture.guest.workspaceId, fixture.replicaId, {
    cardId: fixture.snapshot.cardId, rating: 0, reviewedAtClient: reviewedAt,
    reviewedTimeZone: "Europe/Paris", reviewEventId, clientEventId: randomUUID(),
  }, { clientUpdatedAt: reviewedAt, lastModifiedByReplicaId: fixture.replicaId, lastOperationId: randomUUID() });
  return reviewEventId;
}

test("demo-only completion atomically disposes a reviewed demo, preserves the target scheduler and replays its original destination", async () => {
  await withDemoUpgradeFixture(async (fixture) => {
    const { ownerPool, guest, subject, targetWorkspaceId, snapshot } = fixture;
    const reviewEventId = await reviewDemoInFixture(fixture);
    await ownerPool.query(
      "UPDATE org.workspaces SET fsrs_desired_retention = 0.8, fsrs_client_updated_at = '2099-01-01' WHERE workspace_id = $1",
      [guest.workspaceId],
    );
    const schedulerBefore = await ownerPool.query("SELECT row_to_json(workspace) AS workspace FROM org.workspaces workspace WHERE workspace_id = $1", [targetWorkspaceId]);
    const preparation = await prepareGuestUpgrade(guest.guestToken, subject, null);
    assert.deepEqual(preparation, { mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId });
    const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
    const first = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.deepEqual(first.droppedEntities, {
      cardIds: [snapshot.cardId], deckIds: [], reviewEventIds: [reviewEventId], mediaAssetIds: [],
    });
    assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), {
      userSettingsRows: 0, workspaceRows: 0, liveGuestSessionRows: 0,
    });
    const remains = await ownerPool.query(
      "SELECT (SELECT count(*)::int FROM content.cards WHERE card_id = $1) AS cards, (SELECT count(*)::int FROM content.review_events WHERE review_event_id = $2) AS reviews, (SELECT count(*)::int FROM community.public_review_activity_facts WHERE review_event_id = $2) AS facts",
      [snapshot.cardId, reviewEventId],
    );
    assert.deepEqual(remains.rows[0], { cards: 0, reviews: 0, facts: 0 });
    assert.deepEqual((await ownerPool.query("SELECT row_to_json(workspace) AS workspace FROM org.workspaces workspace WHERE workspace_id = $1", [targetWorkspaceId])).rows, schedulerBefore.rows);
    await ownerPool.query("UPDATE org.user_settings SET workspace_id = NULL WHERE user_id = $1", [fixture.targetUserId]);
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), preparation);
    const replay = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.deepEqual(replay.droppedEntities, first.droppedEntities);
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, { ...selection, workspaceId: randomUUID() }, UPGRADE_CAPABILITIES),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_SELECTION_MISMATCH",
    );
  });
});

test("demo-only runtime eligibility retains the selected suppressed starter beside a visible workspace", async () => {
  await withDemoUpgradeFixture(async (fixture) => {
    const { ownerPool, guest, subject, targetUserId, targetWorkspaceId, snapshot } = fixture;
    await reviewDemoInFixture(fixture);
    const otherWorkspaceId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, targetUserId, { name: "Other workspace", cause: "explicit" }));
    try {
      await ownerPool.query("UPDATE org.workspaces SET starter_suppressed_at = now() WHERE workspace_id = $1", [targetWorkspaceId]);
      const backend = new pg.Client({ connectionString: requireOwnerDatabaseUrl() });
      await backend.connect();
      try {
        await backend.query("BEGIN");
        await backend.query("SET LOCAL ROLE backend_app");
        assert.equal((await backend.query<{ current_user: string }>("SELECT current_user")).rows[0]?.current_user, "backend_app");
        const executor: DatabaseExecutor = { query: (text, params) => backend.query(text, [...params]) };
        await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guest.userId, workspaceId: guest.workspaceId });
        assert.equal((await loadGuestDemoOnlyCardInExecutor(executor, guest.userId, guest.workspaceId))?.cardId, snapshot.cardId);
        assert.equal(await loadDemoOnlyDestinationWorkspaceIdInExecutor(executor, targetUserId), targetWorkspaceId);
        assert.deepEqual((await backend.query<{ workspace_id: string }>("SELECT workspace_id FROM org.visible_workspace_ids(NULL)")).rows,
          [{ workspace_id: otherWorkspaceId }]);
      } finally {
        try { await backend.query("ROLLBACK"); }
        finally { await backend.end(); }
      }
      assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), {
        mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId,
      });
      const completed = await completeGuestUpgrade(guest.guestToken, subject, {
        type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true,
      }, UPGRADE_CAPABILITIES);
      assert.equal(completed.targetWorkspaceId, targetWorkspaceId);
      assert.equal((await ownerPool.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM org.user_settings WHERE user_id = $1", [targetUserId],
      )).rows[0]?.workspace_id, targetWorkspaceId);
    } finally {
      await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [otherWorkspaceId]);
    }
  });
});

test("demo-only qualification preserves edited, ordinary, invalid, deleted and multiple-card guest content", async () => {
  for (const variant of ["edited", "reverted", "ordinary", "invalid", "deleted", "multiple", "source", "type", "deck"]) {
    await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetWorkspaceId, snapshot, replicaId }) => {
      if (variant === "edited") {
        await ownerPool.query("UPDATE content.cards SET back_text = 'Authored answer' WHERE card_id = $1", [snapshot.cardId]);
      } else if (variant === "reverted") {
        await ownerPool.query("UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo,wasEdited}', 'true') WHERE card_id = $1", [snapshot.cardId]);
      } else if (variant === "ordinary") {
        await ownerPool.query("UPDATE content.cards SET metadata = metadata - 'onboardingDemo' WHERE card_id = $1", [snapshot.cardId]);
      } else if (variant === "invalid") {
        await ownerPool.query("UPDATE content.cards SET metadata = jsonb_set(metadata, '{onboardingDemo,version}', '2') WHERE card_id = $1", [snapshot.cardId]);
      } else if (variant === "deleted") {
        await ownerPool.query("UPDATE content.cards SET deleted_at = now() WHERE card_id = $1", [snapshot.cardId]);
      } else if (variant === "multiple") {
        await unsafeTransaction(async (executor) => {
          await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guest.userId, workspaceId: guest.workspaceId });
          await upsertCardSnapshotInExecutor(executor, guest.workspaceId, {
            ...snapshot, cardId: randomUUID(), metadata: { version: 1, source: null },
          }, { clientUpdatedAt: snapshot.createdAt, lastModifiedByReplicaId: replicaId, lastOperationId: randomUUID() });
        });
      } else if (variant === "source") {
        await ownerPool.query("UPDATE content.cards SET metadata = jsonb_set(metadata, '{source}', $2::jsonb) WHERE card_id = $1", [
          snapshot.cardId, JSON.stringify({ label: "Authored source", author: null, comment: null, createdAt: null, importedAt: null, importId: null }),
        ]);
      } else if (variant === "type") {
        await ownerPool.query("UPDATE content.cards SET card_type = 'other' WHERE card_id = $1", [snapshot.cardId]);
      } else {
        await ownerPool.query(
          "INSERT INTO content.decks (deck_id, workspace_id, name, filter_definition, client_updated_at, last_modified_by_replica_id, last_operation_id) VALUES ($1, $2, 'Authored deck', '{}', now(), $3, $4)",
          [randomUUID(), guest.workspaceId, replicaId, randomUUID()],
        );
      }
      assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), { mode: "merge_required" }, variant);
      await assert.rejects(
        completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true }, UPGRADE_CAPABILITIES),
        (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE",
      );
      assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).workspaceRows, 1);
      assert.equal((await ownerPool.query("SELECT card_id FROM content.cards WHERE card_id = $1 AND workspace_id = $2", [snapshot.cardId, guest.workspaceId])).rowCount, 1);
    });
  }
});

test("demo-only completion refuses a stale preparation and a concurrent writer without consuming the guest", async () => {
  await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetWorkspaceId, snapshot }) => {
    assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).demoOnlyDestinationWorkspaceId, targetWorkspaceId);
    const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
    await unsafeTransaction(async (executor) => {
      await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guest.userId, workspaceId: guest.workspaceId });
      await assert.rejects(
        completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
        (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_GUEST_BUSY",
      );
    });
    await ownerPool.query("UPDATE content.cards SET front_text = 'New authored question' WHERE card_id = $1", [snapshot.cardId]);
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE",
    );
    assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).liveGuestSessionRows, 1);
  });
});

test("new-account binding and legacy explicit merge retain the demo and its reviews", async () => {
  await withDemoUpgradeFixture(async (fixture) => {
    const { guest, snapshot, subject, targetWorkspaceId, ownerPool } = fixture;
    const reviewEventId = await reviewDemoInFixture(fixture);
    const selection = { type: "existing", workspaceId: targetWorkspaceId } as const;
    await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal((await ownerPool.query("SELECT card_id FROM content.cards WHERE workspace_id = $1 AND card_id = $2", [targetWorkspaceId, snapshot.cardId])).rowCount, 1);
    assert.equal((await ownerPool.query("SELECT review_event_id FROM content.review_events WHERE workspace_id = $1 AND review_event_id = $2", [targetWorkspaceId, reviewEventId])).rowCount, 1);
  });
  await withDemoUpgradeFixture(async (fixture) => {
    const { guest, snapshot, ownerPool } = fixture;
    const reviewEventId = await reviewDemoInFixture(fixture);
    const newSubject = randomUUID();
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, newSubject, null), { mode: "bound" });
    const completed = await completeGuestUpgrade(guest.guestToken, newSubject, {
      type: "existing", workspaceId: guest.workspaceId,
    }, UPGRADE_CAPABILITIES);
    assert.equal(completed.droppedEntities, undefined);
    assert.equal((await ownerPool.query("SELECT card_id FROM content.cards WHERE workspace_id = $1 AND card_id = $2", [guest.workspaceId, snapshot.cardId])).rowCount, 1);
    assert.equal((await ownerPool.query("SELECT review_event_id FROM content.review_events WHERE workspace_id = $1 AND review_event_id = $2", [guest.workspaceId, reviewEventId])).rowCount, 1);
  });
});

test("demo-only preparation recovers the ordinary existing workspace without creating one, and requires reconciliation capabilities", async () => {
  await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetUserId, targetWorkspaceId }) => {
    await ownerPool.query("UPDATE org.user_settings SET workspace_id = NULL WHERE user_id = $1", [targetUserId]);
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), {
      mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId,
    });
    assert.equal((await ownerPool.query("SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1", [targetUserId])).rowCount, 1);
    const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, selection, {
        ...UPGRADE_CAPABILITIES, guestWorkspaceSyncedAndOutboxDrained: false,
      }),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
    );
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, selection, {
        ...UPGRADE_CAPABILITIES, supportsDroppedEntities: false,
      }),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_DROPPED_ENTITIES_UNSUPPORTED",
    );
    assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).liveGuestSessionRows, 1);
  });
});

test("browser demo-only disposal and lost-response preparation replay the same stored destination", async () => {
  await withGuestUpgradeFixture(() => createBrowserGuestSession(randomUUID()), async ({
    guest, subject, snapshot, targetWorkspaceId,
  }) => {
    const preparation = await prepareBrowserGuestUpgrade(guest.guestToken, subject, null);
    assert.deepEqual(preparation, { mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId });
    const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
    const first = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.deepEqual(first.droppedEntities?.cardIds, [snapshot.cardId]);
    assert.deepEqual(await prepareBrowserGuestUpgrade(guest.guestToken, subject, null), preparation);
    const replay = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.deepEqual(replay.droppedEntities, first.droppedEntities);
    await assert.rejects(
      completeBrowserGuestUpgrade(guest.guestToken, subject, { ...selection, workspaceId: randomUUID() }, UPGRADE_CAPABILITIES),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_SELECTION_MISMATCH",
    );
  });
});
