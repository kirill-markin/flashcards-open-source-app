import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { unsafeTransaction } from "../../database/unsafe";
import { applyWorkspaceDatabaseScopeInExecutor, transactionWithUserScope, transactionWithWorkspaceScope, type DatabaseExecutor, type SqlValue } from "../../database";
import { upsertCardSnapshotInExecutor, submitReview, type CardSnapshotInput } from "../../cards";
import { ensureWorkspaceReplicaInExecutor } from "../../sync/identity/replica";
import { loadUserProgressSeries, loadUserProgressSummary } from "../../progress";
import { createBrowserGuestSession, loadBrowserGuestSession } from "../browser/session";
import { linkProvedCognitoPrincipalInExecutor } from "../../auth/userIdentities";
import { ensureCognitoUserProfile } from "../../auth/ensureUser";
import { createWorkspaceInExecutor } from "../../workspaces/create";
import { lockWorkspaceMembershipLifecyclesInExecutor } from "../../workspaces/accessLocks";
import { loadWorkspaceChatInstructionsForUser, saveWorkspaceChatInstructionsForUser } from "../../chat/customInstructions";
import { createFreshChatSessionWithExecutor } from "../../chat/store/sessionService";
import {
  loadDemoOnlyDestinationWorkspaceIdInExecutor,
  loadGuestDemoOnlyCardInExecutor,
} from "../store/demoOnly";
import { linkGuestAnalyticsIdentityInExecutor } from "../identityLink";
import { reapWebGuestInExecutor } from "../reaper";
import { deleteGuestSessionInExecutor } from "../delete";
import { hashGuestToken } from "../shared";
import { updateAccountPreferences } from "../../routes/system/account/accountPreferences";
import { parseAccountPreferencesInput } from "../../routes/system/support";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import { configureBackendRuntimeObservability, resetBackendRuntimeObservability } from "../../observability/runtime";
import { loadPaywallState, recordPaywallShown, type PaywallShownInput } from "../../paywallState";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  completeGuestUpgradeInExecutor,
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

test("guest merge adopts a guest accent and appearance only for a default destination and preserves them on replay", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  const cases = [
    { targetColor: "#FF6719", targetAppearance: {}, expectedTheme: "light", expectedFollowSystemAppearance: true },
    {
      targetColor: "#4D8DFF",
      targetAppearance: { followSystemAppearance: true },
      expectedTheme: "dark",
      expectedFollowSystemAppearance: true,
    },
    {
      targetColor: "#C44B2D",
      targetAppearance: { theme: "light" },
      expectedTheme: "light",
      expectedFollowSystemAppearance: false,
    },
  ] as const;
  try {
    for (const { targetColor, targetAppearance, expectedTheme, expectedFollowSystemAppearance } of cases) {
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
      await updateAccountPreferences(
        guest.userId,
        parseAccountPreferencesInput({ accentColor: "#F472B6", theme: "light", followSystemAppearance: true }),
      );
      await updateAccountPreferences(
        target.userId,
        parseAccountPreferencesInput({ accentColor: targetColor, ...targetAppearance }),
      );
      assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "merge_required");
      const selection = { type: "existing", workspaceId: targetWorkspaceId } as const;
      await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      const expectedColor = targetColor === "#FF6719" ? "#F472B6" : targetColor;
      const merged = (await ensureCognitoUserProfile(subject, null)).preferences;
      assert.equal(merged.accentColor, expectedColor);
      assert.equal(merged.theme, expectedTheme);
      assert.equal(merged.followSystemAppearance, expectedFollowSystemAppearance);

      await updateAccountPreferences(
        target.userId,
        parseAccountPreferencesInput({ accentColor: "#EAB308", theme: "dark" }),
      );
      const replay = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      assert.equal(replay.outcome, "idempotent_replay");
      const replayed = (await ensureCognitoUserProfile(subject, null)).preferences;
      assert.equal(replayed.accentColor, "#EAB308");
      assert.equal(replayed.theme, "dark");
      assert.equal(replayed.followSystemAppearance, false);
    }
  } finally {
    try {
      await removeAccounts(ownerPool, userIds, workspaceIds);
    } finally {
      await ownerPool.end();
    }
  }
});

test("only weekly appearances move the periodic paywall clock, and guest merge keeps the later one", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  const shown = (shownAt: string, reviewTrigger: PaywallShownInput["reviewTrigger"]): PaywallShownInput => ({
    presentationId: randomUUID(), shownAt, localDate: shownAt.slice(0, 10), timeZone: "UTC", reviewTrigger,
  });
  try {
    const guest = await createGuestSession("android", null);
    userIds.push(guest.userId);
    workspaceIds.push(guest.workspaceId);
    const subject = randomUUID();
    const target = await ensureCognitoUserProfile(subject, null);
    userIds.push(target.userId);
    const targetWorkspaceId = target.selectedWorkspaceId;
    if (targetWorkspaceId === null) {
      throw new Error(`Account ${target.userId} has no workspace.`);
    }
    workspaceIds.push(targetWorkspaceId);
    await recordPaywallShown(target.userId, shown("2026-10-01T00:00:00.000Z", "weekly"));
    const afterDay3 = await recordPaywallShown(target.userId, shown("2026-10-03T00:00:00.000Z", "day3"));
    assert.equal(afterDay3.periodicShownAt, "2026-10-01T00:00:00.000Z");
    assert.equal(afterDay3.lastShownAt, "2026-10-03T00:00:00.000Z");
    await recordPaywallShown(guest.userId, shown("2026-10-02T00:00:00.000Z", "weekly"));

    assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "merge_required");
    await completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: targetWorkspaceId },
      UPGRADE_CAPABILITIES);
    const merged = await loadPaywallState(target.userId);
    assert.equal(merged.periodicShownAt, "2026-10-02T00:00:00.000Z");
    assert.equal(merged.lastShownAt, "2026-10-03T00:00:00.000Z");
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
  userIds: string[];
  workspaceIds: string[];
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
        isTestDistribution: false,
      });
      await upsertCardSnapshotInExecutor(executor, guest.workspaceId, snapshot, {
        clientUpdatedAt: createdAt, lastModifiedByReplicaId: replica, lastOperationId: randomUUID(),
      });
      return replica;
    });
    await callback({
      ownerPool, guest, subject, targetUserId: target.userId,
      targetWorkspaceId: target.selectedWorkspaceId, replicaId, snapshot, userIds, workspaceIds,
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

function createEmptyChatInFixture(fixture: DemoUpgradeFixture): Promise<string> {
  return unsafeTransaction((executor) => createFreshChatSessionWithExecutor(executor, {
    userId: fixture.guest.userId, workspaceId: fixture.guest.workspaceId,
  }, undefined, null));
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
    const sessionId = await createEmptyChatInFixture(fixture);
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
        await backend.query(
          `INSERT INTO ai.chat_items (session_id, item_kind, state, payload)
           VALUES ($1, 'message', 'completed', '{"role":"user","content":[{"type":"text","text":"My question"}]}')`,
          [sessionId],
        );
        assert.equal(await loadGuestDemoOnlyCardInExecutor(executor, guest.userId, guest.workspaceId), null);
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

test("demo-only qualification preserves chat content, files, authored history and active work", async () => {
  const sessionChanges = [
    ["running", "status = 'running'"], ["interrupted", "status = 'interrupted'"],
    ["active run", "active_run_id = gen_random_uuid()"], ["heartbeat", "active_run_heartbeat_at = now()"],
    ["title", "title = 'My chat'"], ["archived", "archived_at = now()"],
    ["invalidated content", "main_content_invalidation_version = 1"],
  ] as const;
  for (const variant of [...sessionChanges.map(([label]) => label), "message", "file", "queued run", "completed run"]) {
    await withDemoUpgradeFixture(async (fixture) => {
      const { ownerPool, guest, subject, targetWorkspaceId } = fixture;
      const sessionId = await createEmptyChatInFixture(fixture);
      const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
      assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).demoOnlyDestinationWorkspaceId, targetWorkspaceId);
      const sessionChange = sessionChanges.find(([label]) => label === variant);
      if (sessionChange !== undefined) {
        await ownerPool.query(`UPDATE ai.chat_sessions SET ${sessionChange[1]} WHERE session_id = $1`, [sessionId]);
      } else if (variant === "file") {
        await ownerPool.query(
          `INSERT INTO ai.chat_files (file_id, session_id, user_id, workspace_id, path, origin, media_type, size_bytes, sha256, s3_key)
           VALUES ($1, $2, $3, $4, '/files/notes.txt', 'attachment', 'text/plain', 1, repeat('a', 64), $5)`,
          [randomUUID(), sessionId, guest.userId, guest.workspaceId, `postgres-integration/${randomUUID()}`],
        );
      } else {
        const itemId = randomUUID();
        await ownerPool.query(
          `INSERT INTO ai.chat_items (item_id, session_id, item_kind, state, payload)
           VALUES ($1, $2, 'message', $3, $4::jsonb)`,
          [itemId, sessionId, variant === "queued run" ? "in_progress" : "completed", JSON.stringify({
            role: variant === "message" ? "user" : "assistant",
            content: variant === "queued run" ? [] : [{ type: "text", text: "Saved chat content" }],
          })],
        );
        if (variant !== "message") {
          await ownerPool.query(
            `INSERT INTO ai.chat_runs (session_id, assistant_item_id, status, request_id, model_id, reasoning_effort, timezone, turn_input)
             VALUES ($1, $2, $3, $4, 'gpt-5.6-terra', 'xhigh', 'Europe/Paris', '[]')`,
            [sessionId, itemId, variant === "queued run" ? "queued" : "completed", randomUUID()],
          );
        }
      }
      assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), { mode: "merge_required" }, variant);
      await assert.rejects(completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
        (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE", variant);
      assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).liveGuestSessionRows, 1, variant);
      assert.equal((await ownerPool.query("SELECT session_id FROM ai.chat_sessions WHERE session_id = $1", [sessionId])).rowCount, 1, variant);
    });
  }
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

test("demo-only completion retries a short guest scope, but preserves a busy or edited guest", { timeout: 10_000 }, async () => {
  const retries: Array<Readonly<{ attempt: number; delayMs: number }>> = [];
  let notifyFirstRetry!: () => void;
  const firstRetry = new Promise<void>((resolve) => { notifyFirstRetry = resolve; });
  configureBackendRuntimeObservability("backend-api", {
    addBreadcrumb: () => undefined,
    captureException: (event) => { throw event.error; },
    captureWarning: (event) => {
      if (event.action === "guest_upgrade_guest_busy_retry") {
        retries.push({ attempt: event.details.attempt, delayMs: event.details.delayMs });
        notifyFirstRetry();
      }
    },
  });
  try {
    await withDemoUpgradeFixture(async (fixture) => {
      const { ownerPool, guest, subject, targetUserId, targetWorkspaceId, snapshot } = fixture;
      const reviewEventId = await reviewDemoInFixture(fixture);
      assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).demoOnlyDestinationWorkspaceId, targetWorkspaceId);
      const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
      const { completion } = await unsafeTransaction(async (executor) => {
        await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guest.userId, workspaceId: guest.workspaceId });
        const completion = completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
        await Promise.race([firstRetry, completion.then(() => assert.fail("Completion must first refuse the held guest scope."))]);
        const subjectLock = await ownerPool.query<Readonly<{ locked: boolean }>>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || $1::text, 2::bigint)) AS locked",
          [subject],
        );
        assert.equal(subjectLock.rows[0]?.locked, true);
        return { completion };
      });
      const completed = await completion;
      assert.equal(completed.outcome, "fresh_completion");
      assert.equal(completed.targetWorkspaceId, targetWorkspaceId);
      assert.deepEqual(completed.droppedEntities, {
        cardIds: [snapshot.cardId], deckIds: [], reviewEventIds: [reviewEventId], mediaAssetIds: [],
      });
      assert.deepEqual(retries, [{ attempt: 1, delayMs: 100 }]);
      assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), {
        userSettingsRows: 0, workspaceRows: 0, liveGuestSessionRows: 0,
      });
      const replay = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      assert.equal(replay.outcome, "idempotent_replay");
      assert.equal(replay.targetWorkspaceId, targetWorkspaceId);
      assert.deepEqual(replay.droppedEntities, completed.droppedEntities);
      assert.deepEqual((await ownerPool.query(
        "SELECT target_user_id, target_workspace_id FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1",
        [guest.userId],
      )).rows, [{ target_user_id: targetUserId, target_workspace_id: targetWorkspaceId }]);
      assert.equal((await ownerPool.query(
        "SELECT event_id FROM analytics.product_events WHERE event_name = 'guest_upgrade_completed' AND guest_session_id = $1",
        [completed.guestSessionId],
      )).rowCount, 1);
      assert.equal((await ownerPool.query(
        "SELECT link_id FROM analytics.identity_links WHERE anonymous_id = $1 AND user_id = $2",
        [guest.userId, targetUserId],
      )).rowCount, 1);
    });
    retries.length = 0;
    await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetWorkspaceId, snapshot }) => {
      assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).demoOnlyDestinationWorkspaceId, targetWorkspaceId);
      const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
      await unsafeTransaction(async (executor) => {
        await applyWorkspaceDatabaseScopeInExecutor(executor, { userId: guest.userId, workspaceId: guest.workspaceId });
        await assert.rejects(
          completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
          (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.code === "GUEST_UPGRADE_GUEST_BUSY",
        );
      });
      assert.deepEqual(retries, [{ attempt: 1, delayMs: 100 }, { attempt: 2, delayMs: 200 }]);
      assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), {
        userSettingsRows: 1, workspaceRows: 1, liveGuestSessionRows: 1,
      });
      assert.equal((await ownerPool.query(
        "SELECT upgrade_id FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1", [guest.userId],
      )).rowCount, 0);
      assert.equal((await ownerPool.query(
        "SELECT event_id FROM analytics.product_events WHERE event_name = 'guest_upgrade_completed' AND subject_user_id = $1", [guest.userId],
      )).rowCount, 0);
      await ownerPool.query("UPDATE content.cards SET front_text = 'New authored question' WHERE card_id = $1", [snapshot.cardId]);
      await assert.rejects(
        completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
        (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE",
      );
      assert.deepEqual(retries, [{ attempt: 1, delayMs: 100 }, { attempt: 2, delayMs: 200 }]);
      assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).liveGuestSessionRows, 1);
    });
  } finally {
    resetBackendRuntimeObservability();
  }
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

test("a missing native destination leaves the guest transferable and a missing replay result cannot be reselected", async () => {
  await withGuestUpgradeFixture(() => createGuestSession("android", null), async ({ guest, subject, targetWorkspaceId, snapshot, ownerPool }) => {
    const preparation = await prepareGuestUpgrade(guest.guestToken, subject, null);
    assert.equal(preparation.mode, "merge_required");

    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: randomUUID() }, UPGRADE_CAPABILITIES),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "WORKSPACE_NOT_FOUND");
        assert.deepEqual(createPublicHttpErrorDetails(error.details), { guestUpgradeDestinationUnavailable: true });
        return true;
      },
    );
    assert.equal((await authenticateGuestSession(guest.guestToken)).userId, guest.userId);
    assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), {
      userSettingsRows: 1, workspaceRows: 1, liveGuestSessionRows: 1,
    });
    assert.equal((await ownerPool.query("SELECT 1 FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1", [guest.userId])).rowCount, 0);

    const selection = { type: "existing", workspaceId: targetWorkspaceId } as const;
    const completed = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal(completed.outcome, "fresh_completion");
    assert.deepEqual((await ownerPool.query("SELECT workspace_id FROM content.cards WHERE card_id = $1", [snapshot.cardId])).rows, [
      { workspace_id: targetWorkspaceId },
    ]);

    await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [targetWorkspaceId]);
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES),
      { statusCode: 404, code: "WORKSPACE_NOT_FOUND", details: null },
    );
  });
});

test("browser demo-only disposal and lost-response preparation replay the same stored destination", async () => {
  await withGuestUpgradeFixture(() => createBrowserGuestSession(randomUUID(), null), async (fixture) => {
    const { guest, subject, snapshot, targetWorkspaceId, ownerPool } = fixture;
    const reviewEventId = await reviewDemoInFixture(fixture);
    const sessionId = await createEmptyChatInFixture(fixture);
    const preparation = await prepareBrowserGuestUpgrade(guest.guestToken, subject, null);
    assert.deepEqual(preparation, { mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId });
    const selection = { type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true } as const;
    await assert.rejects(
      completeBrowserGuestUpgrade(guest.guestToken, subject, { ...selection, workspaceId: randomUUID() }, UPGRADE_CAPABILITIES),
      { statusCode: 404, code: "WORKSPACE_NOT_FOUND", details: null },
    );
    const first = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.deepEqual(first.droppedEntities?.cardIds, [snapshot.cardId]);
    assert.deepEqual(first.droppedEntities?.reviewEventIds, [reviewEventId]);
    assert.deepEqual(await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId), {
      userSettingsRows: 0, workspaceRows: 0, liveGuestSessionRows: 0,
    });
    assert.equal((await ownerPool.query("SELECT session_id FROM ai.chat_sessions WHERE session_id = $1", [sessionId])).rowCount, 0);
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

test("conflicting instructions preserve both destinations and transfer additional workspace access, sync, and progress", async () => {
  await withGuestUpgradeFixture(() => createBrowserGuestSession(randomUUID(), null), async (fixture) => {
    const { ownerPool, guest, subject, targetUserId, targetWorkspaceId, userIds, workspaceIds } = fixture;
    const additionalId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Guest archive", cause: "explicit" }));
    const privateId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Solo guest workspace", cause: "explicit" }));
    workspaceIds.push(additionalId, privateId);
    await saveWorkspaceChatInstructionsForUser(guest.userId, privateId, "A private workspace rule.");
    const other = await ensureCognitoUserProfile(randomUUID(), null);
    userIds.push(other.userId);
    assert.ok(other.selectedWorkspaceId);
    workspaceIds.push(other.selectedWorkspaceId);
    await ownerPool.query(
      "INSERT INTO org.workspace_memberships(workspace_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
      [additionalId, targetUserId, other.userId],
    );
    const installation = {
      workspaceId: additionalId, installationId: randomUUID(), platform: "web", appVersion: null,
      osName: null, deviceType: null, isAutomation: true, isTestDistribution: false,
    } as const;
    const card = { ...fixture.snapshot, cardId: randomUUID() };
    const replicaId = await unsafeTransaction(async (executor) => {
      const replica = await ensureWorkspaceReplicaInExecutor(executor, { ...installation, userId: guest.userId });
      await upsertCardSnapshotInExecutor(executor, additionalId, card, {
        clientUpdatedAt: card.createdAt, lastModifiedByReplicaId: replica, lastOperationId: randomUUID(),
      });
      return replica;
    });
    const timeZone = "UTC";
    const reviewDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    async function addReview(userId: string, reviewReplicaId: string, rating: 0 | 1 | 2, reviewedAtClient: string): Promise<string> {
      const reviewEventId = randomUUID();
      await submitReview(userId, additionalId, reviewReplicaId, {
        cardId: card.cardId, rating, reviewedAtClient, reviewedTimeZone: timeZone,
        reviewEventId, clientEventId: randomUUID(),
      }, { clientUpdatedAt: reviewedAtClient, lastModifiedByReplicaId: reviewReplicaId, lastOperationId: randomUUID() });
      return reviewEventId;
    }
    const reviewId = await addReview(guest.userId, replicaId, 2, reviewDay + "T12:00:00.000Z");
    const targetReplicaId = await unsafeTransaction((executor) => ensureWorkspaceReplicaInExecutor(
      executor, { ...installation, userId: targetUserId, installationId: randomUUID() },
    ));
    const targetReviewId = await addReview(targetUserId, targetReplicaId, 1, reviewDay + "T13:00:00.000Z");
    const otherReplicaId = await unsafeTransaction((executor) => ensureWorkspaceReplicaInExecutor(
      executor, { ...installation, userId: other.userId, installationId: randomUUID() },
    ));
    const otherReviewId = await addReview(other.userId, otherReplicaId, 0, reviewDay + "T14:00:00.000Z");
    await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, "Answer in Spanish.");
    await saveWorkspaceChatInstructionsForUser(guest.userId, additionalId, "Answer in French.");
    await saveWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId, "Answer in German.");

    assert.deepEqual(await prepareBrowserGuestUpgrade(guest.guestToken, subject, null), { mode: "merge_required" });
    const selection = { type: "existing", workspaceId: targetWorkspaceId.toUpperCase() } as const;
    const completion = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    const resolvedId = completion.workspace.workspaceId;
    workspaceIds.push(resolvedId);
    assert.notEqual(resolvedId, targetWorkspaceId);
    assert.notEqual(resolvedId, guest.workspaceId);
    assert.equal((await ensureCognitoUserProfile(subject, null)).selectedWorkspaceId, resolvedId);
    const durable = await ownerPool.query(
      "SELECT selection_type, requested_existing_workspace_id, target_workspace_id FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1",
      [guest.userId],
    );
    assert.deepEqual(durable.rows, [{
      selection_type: "existing", requested_existing_workspace_id: targetWorkspaceId, target_workspace_id: resolvedId,
    }]);
    assert.deepEqual(await prepareBrowserGuestUpgrade(guest.guestToken, subject, null), {
      mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId,
    });
    const replay = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.deepEqual(replay.workspace, completion.workspace);
    const canonicalReplay = await completeBrowserGuestUpgrade(
      guest.guestToken, subject, { ...selection, workspaceId: targetWorkspaceId }, UPGRADE_CAPABILITIES,
    );
    assert.deepEqual(canonicalReplay, replay);
    await assert.rejects(
      completeBrowserGuestUpgrade(guest.guestToken, subject, { ...selection, workspaceId: resolvedId }, UPGRADE_CAPABILITIES),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_SELECTION_MISMATCH",
    );
    await assert.rejects(
      completeBrowserGuestUpgrade(guest.guestToken, subject, { type: "create_new" }, UPGRADE_CAPABILITIES),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_UPGRADE_SELECTION_MISMATCH",
    );
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId)).customInstructions, "Answer in German.");
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, resolvedId)).customInstructions, "Answer in Spanish.");
    assert.deepEqual(await loadWorkspaceChatInstructionsForUser(targetUserId, additionalId), {
      customInstructions: "Answer in French.", maxLength: 1500, canEdit: true,
    });
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, privateId)).canEdit, true);
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, privateId)).customInstructions, "A private workspace rule.");
    await assert.rejects(authenticateGuestSession(guest.guestToken), isGuestAuthInvalid);
    await assert.rejects(loadWorkspaceChatInstructionsForUser(guest.userId, additionalId), { code: "WORKSPACE_NOT_FOUND" });
    const activeCard = await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: resolvedId },
      async (executor) => executor.query("SELECT card_id FROM content.cards WHERE card_id = $1", [fixture.snapshot.cardId]));
    assert.deepEqual(activeCard.rows, [{ card_id: fixture.snapshot.cardId }]);
    await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: additionalId }, async (executor) => {
      assert.equal(await ensureWorkspaceReplicaInExecutor(executor, { ...installation, userId: targetUserId }), replicaId);
      const cards = await executor.query("SELECT card_id FROM content.cards WHERE card_id = $1", [card.cardId]);
      const reviews = await executor.query(
        "SELECT review_event_id, reviewed_by_user_id FROM content.review_events WHERE card_id = $1 ORDER BY reviewed_at_client",
        [card.cardId],
      );
      assert.deepEqual(cards.rows, [{ card_id: card.cardId }]);
      assert.deepEqual(reviews.rows, [
        { review_event_id: reviewId, reviewed_by_user_id: targetUserId },
        { review_event_id: targetReviewId, reviewed_by_user_id: targetUserId },
        { review_event_id: otherReviewId, reviewed_by_user_id: other.userId },
      ]);
    });
    const facts = await ownerPool.query(
      [
        "SELECT facts.review_event_id, facts.reviewed_by_user_id, profiles.user_id AS profile_owner,",
        "facts.is_countable, facts.exclusion_reason FROM community.public_review_activity_facts AS facts",
        "JOIN community.public_profiles AS profiles USING (public_profile_id)",
        "WHERE facts.review_event_id = ANY($1::uuid[]) ORDER BY facts.reviewed_at_client",
      ].join(" "),
      [[reviewId, targetReviewId, otherReviewId]],
    );
    assert.deepEqual(facts.rows, [
      { review_event_id: reviewId, reviewed_by_user_id: targetUserId, profile_owner: targetUserId, is_countable: true, exclusion_reason: null },
      { review_event_id: targetReviewId, reviewed_by_user_id: targetUserId, profile_owner: targetUserId, is_countable: true, exclusion_reason: null },
      { review_event_id: otherReviewId, reviewed_by_user_id: other.userId, profile_owner: other.userId, is_countable: false, exclusion_reason: "again" },
    ]);
    const activeDays = await ownerPool.query<Readonly<{ reviewed_by_user_id: string; review_count: number }>>(
      "SELECT reviewed_by_user_id, review_count FROM progress.user_active_review_days WHERE reviewed_by_user_id = ANY($1::text[]) AND local_date = $2",
      [[guest.userId, targetUserId, other.userId], reviewDay],
    );
    assert.deepEqual(new Map(activeDays.rows.map((row) => [row.reviewed_by_user_id, row.review_count])), new Map([
      [targetUserId, 2],
      [other.userId, 1],
    ]));
    const { summary } = await loadUserProgressSummary({ userId: targetUserId, timeZone });
    assert.equal(summary.activeReviewDays, 1);
    assert.equal(summary.lastReviewedOn, reviewDay);
    const series = await loadUserProgressSeries({ userId: targetUserId, timeZone, from: reviewDay, to: reviewDay });
    assert.deepEqual(series.dailyReviews, [
      { date: reviewDay, reviewCount: 2, againCount: 0, hardCount: 1, goodCount: 1, easyCount: 0 },
    ]);
    assert.deepEqual(series.streakDays, [{ date: reviewDay, state: "reviewed" }]);
  });
});

test("retained workspace transfer requires the source guest scope and live receipt credential", async () => {
  await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetUserId, targetWorkspaceId, workspaceIds }) => {
    const additionalId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Guest archive", cause: "explicit" }));
    workspaceIds.push(additionalId);
    const upgradeId = randomUUID();
    const secretHash = hashGuestToken(guest.guestToken);
    const receipt = await ownerPool.query(
      [
        "INSERT INTO auth.guest_upgrade_history (upgrade_id, source_guest_user_id, source_guest_workspace_id,",
        "source_guest_session_id, source_guest_session_secret_hash, target_subject_user_id, target_user_id,",
        "target_workspace_id, selection_type)",
        "SELECT $1, user_id, $2, session_id, session_secret_hash, $3, $4, $5, 'existing'",
        "FROM auth.guest_sessions WHERE user_id = $6",
      ].join(" "),
      [upgradeId, guest.workspaceId, subject, targetUserId, targetWorkspaceId, guest.userId],
    );
    assert.equal(receipt.rowCount, 1);
    const transfer = (userId: string, receiptHash: string) => transactionWithUserScope({ userId }, (executor) =>
      executor.query("SELECT auth.transfer_guest_owned_workspaces($1, $2)", [upgradeId, receiptHash]));
    await assert.rejects(transfer(targetUserId, secretHash), { code: "42501" });
    await assert.rejects(transfer(guest.userId, hashGuestToken(randomUUID())), { code: "42501" });
    await ownerPool.query("UPDATE auth.guest_sessions SET revoked_at = now() WHERE user_id = $1", [guest.userId]);
    await assert.rejects(transfer(guest.userId, secretHash), { code: "42501" });
    await assert.rejects(loadWorkspaceChatInstructionsForUser(targetUserId, additionalId), { code: "WORKSPACE_NOT_FOUND" });
  });
});

test("guest instruction transfer observes target ownership, empty settings, and identical values", async (t) => {
  const scenarios = [
    { title: "owner fills empty target", role: "owner", source: "Guest rule.", destination: null, separate: false },
    { title: "owner merges identical text", role: "owner", source: "Same rule.", destination: "Same rule.", separate: false },
    { title: "member preserves existing target", role: "member", source: null, destination: "Account rule.", separate: false },
    { title: "member merges identical text", role: "member", source: "Same rule.", destination: "Same rule.", separate: false },
    { title: "member cannot fill empty target", role: "member", source: "Guest rule.", destination: null, separate: true },
    { title: "explicit new workspace preserves guest text", role: "new", source: "Guest rule.", destination: null, separate: true },
  ] as const;
  for (const scenario of scenarios) {
    await t.test(scenario.title, async () => withDemoUpgradeFixture(async (fixture) => {
      const { ownerPool, guest, subject, targetUserId, targetWorkspaceId, workspaceIds } = fixture;
      if (scenario.source !== null) await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, scenario.source);
      if (scenario.destination !== null) await saveWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId, scenario.destination);
      if (scenario.role === "member") {
        await ownerPool.query("UPDATE org.workspace_memberships SET role = 'member' WHERE workspace_id = $1 AND user_id = $2",
          [targetWorkspaceId, targetUserId]);
      }
      const selection = scenario.role === "new"
        ? { type: "create_new", name: "Guest study" } as const
        : { type: "existing", workspaceId: targetWorkspaceId } as const;
      const first = await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
      const resolvedId = first.workspace.workspaceId;
      workspaceIds.push(resolvedId);
      assert.equal(resolvedId !== targetWorkspaceId, scenario.separate);
      if (scenario.role === "new") assert.equal(first.workspace.name, "Guest study");
      assert.deepEqual(await loadWorkspaceChatInstructionsForUser(targetUserId, resolvedId), {
        customInstructions: scenario.source ?? scenario.destination,
        maxLength: 1500,
        canEdit: scenario.separate || scenario.role === "owner",
      });
      if (scenario.separate) {
        assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId)).customInstructions, scenario.destination);
      }
      if (scenario.role === "owner" && scenario.destination === null) {
        await ownerPool.query("UPDATE auth.guest_upgrade_history SET requested_existing_workspace_id = NULL WHERE source_guest_user_id = $1", [guest.userId]);
      }
      assert.deepEqual((await completeGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES)).workspace, first.workspace);
      if (scenario.separate && scenario.role === "member") {
        await assert.rejects(
          completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: resolvedId }, UPGRADE_CAPABILITIES),
          { code: "GUEST_UPGRADE_SELECTION_MISMATCH" },
        );
      }
    }));
  }
});

test("a stale demo-only shortcut aborts and leaves guest and target access intact", async () => {
  await withDemoUpgradeFixture(async ({ guest, subject, targetUserId, targetWorkspaceId, ownerPool }) => {
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), {
      mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId,
    });
    await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, "Keep this text.");
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), { mode: "merge_required" });
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, {
        type: "existing", workspaceId: targetWorkspaceId, discardDemoOnly: true,
      }, UPGRADE_CAPABILITIES),
      { code: "GUEST_UPGRADE_DEMO_ONLY_NOT_ELIGIBLE" },
    );
    assert.equal((await authenticateGuestSession(guest.guestToken)).userId, guest.userId);
    assert.equal((await loadWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId)).customInstructions, "Keep this text.");
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId)).customInstructions, null);
    assert.equal((await ensureCognitoUserProfile(subject, null)).selectedWorkspaceId, targetWorkspaceId);
    assert.equal((await ownerPool.query("SELECT 1 FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1", [guest.userId])).rowCount, 0);
  });
});

test("first sign-in keeps the same workspace owner and instructions", async () => {
  await withDemoUpgradeFixture(async ({ ownerPool, guest, workspaceIds }) => {
    const other = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Guest archive", cause: "explicit" }));
    workspaceIds.push(other);
    for (const id of [guest.workspaceId, other]) await saveWorkspaceChatInstructionsForUser(guest.userId, id, "Keep both.");
    const subject = randomUUID();
    assert.deepEqual(await prepareGuestUpgrade(guest.guestToken, subject, null), { mode: "bound" });
    const completion = await completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: guest.workspaceId }, UPGRADE_CAPABILITIES);
    assert.equal(completion.targetUserId, guest.userId);
    assert.equal(completion.workspace.workspaceId, guest.workspaceId);
    assert.equal((await ownerPool.query("SELECT count(*)::int AS count FROM org.workspace_memberships WHERE user_id = $1 AND role = 'owner'", [guest.userId])).rows[0].count, 2);
    for (const id of [guest.workspaceId, other]) {
      assert.equal((await loadWorkspaceChatInstructionsForUser(guest.userId, id)).customInstructions, "Keep both.");
    }
  });
});

test("analytics retirement and reaping protect instructions on an additional guest workspace during a save", async () => {
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  try {
    const guest = await createGuestSession("web", null);
    const emptyGuest = await createGuestSession("web", null);
    const subject = randomUUID();
    const target = await ensureCognitoUserProfile(subject, null);
    assert.ok(target.selectedWorkspaceId);
    userIds.push(guest.userId, emptyGuest.userId, target.userId);
    workspaceIds.push(guest.workspaceId, emptyGuest.workspaceId, target.selectedWorkspaceId);
    const other = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Guest archive", cause: "explicit" }));
    workspaceIds.push(other);
    await ownerPool.query("UPDATE auth.guest_sessions SET created_at = now() - interval '120 days' WHERE user_id = ANY($1)", [
      [guest.userId, emptyGuest.userId],
    ]);
    const reap = (userId: string) => unsafeTransaction((executor) => reapWebGuestInExecutor(executor, {
      guestUserId: userId, analyticsUserId: userId, latestSessionCreatedAt: new Date(0).toISOString(),
      lastActiveAt: new Date(0).toISOString(),
    }, new Date(Date.now() - 90 * 86_400_000)));
    const link = () => unsafeTransaction((executor) => linkGuestAnalyticsIdentityInExecutor(executor, guest.guestToken, subject));
    await transactionWithWorkspaceScope({ userId: guest.userId, workspaceId: other }, async (executor) => {
      await executor.query("INSERT INTO ai.workspace_chat_instructions (workspace_id, custom_instructions) VALUES ($1, $2)", [
        other, "Keep this while saving.",
      ]);
      await assert.rejects(link(), { code: "GUEST_IDENTITY_LINK_GUEST_BUSY" });
      assert.deepEqual(await reap(guest.userId), { outcome: "skipped", workspaceId: null, reason: "no_longer_a_candidate" });
    });
    await assert.rejects(link(), { code: "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED" });
    assert.deepEqual(await reap(guest.userId), { outcome: "skipped", workspaceId: guest.workspaceId, reason: "workspace_has_content" });
    assert.equal((await loadWorkspaceChatInstructionsForUser(guest.userId, other)).customInstructions, "Keep this while saving.");
    assert.equal((await readGuestAccountState(ownerPool, guest.userId, guest.workspaceId)).liveGuestSessionRows, 1);
    assert.deepEqual(await reap(emptyGuest.userId), { outcome: "deleted", workspaceId: emptyGuest.workspaceId });
    await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, "Remove with explicit deletion.");
    await unsafeTransaction((executor) => deleteGuestSessionInExecutor(executor, guest.guestToken));
    assert.equal((await ownerPool.query("SELECT 1 FROM ai.workspace_chat_instructions WHERE workspace_id = $1", [guest.workspaceId])).rowCount, 0);
  } finally {
    try { await removeAccounts(ownerPool, userIds, workspaceIds); } finally { await ownerPool.end(); }
  }
});

test("a failed source cleanup rolls back the target instruction and additional membership writes", async () => {
  await withDemoUpgradeFixture(async ({ ownerPool, guest, subject, targetUserId, targetWorkspaceId, workspaceIds, snapshot }) => {
    const additionalId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, guest.userId, { name: "Guest archive", cause: "explicit" }));
    workspaceIds.push(additionalId);
    await ownerPool.query(
      "INSERT INTO org.workspace_memberships(workspace_id, user_id, role) VALUES ($1, $2, 'member')",
      [guest.workspaceId, targetUserId],
    );
    await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, "Restore on rollback.");
    await saveWorkspaceChatInstructionsForUser(guest.userId, additionalId, "Keep guest ownership.");
    await assert.rejects(
      completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: targetWorkspaceId }, UPGRADE_CAPABILITIES),
      { code: "WORKSPACE_DELETE_SHARED" },
    );
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId)).customInstructions, null);
    assert.equal((await ensureCognitoUserProfile(subject, null)).selectedWorkspaceId, targetWorkspaceId);
    assert.equal((await loadWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId)).customInstructions, "Restore on rollback.");
    assert.equal((await loadWorkspaceChatInstructionsForUser(guest.userId, additionalId)).customInstructions, "Keep guest ownership.");
    await assert.rejects(loadWorkspaceChatInstructionsForUser(targetUserId, additionalId), { code: "WORKSPACE_NOT_FOUND" });
    assert.equal((await authenticateGuestSession(guest.guestToken)).userId, guest.userId);
    assert.deepEqual((await ownerPool.query("SELECT workspace_id FROM content.cards WHERE card_id = $1", [snapshot.cardId])).rows, [
      { workspace_id: guest.workspaceId },
    ]);
    assert.equal((await ownerPool.query("SELECT 1 FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1", [guest.userId])).rowCount, 0);
  });
});

test("conversion with an uppercase destination waits for a target owner's workspace lock", async () => {
  await withDemoUpgradeFixture(async ({ guest, subject, targetUserId, targetWorkspaceId, workspaceIds }) => {
    await saveWorkspaceChatInstructionsForUser(guest.userId, guest.workspaceId, "Guest rule.");
    await assert.rejects(completeGuestUpgrade(
      guest.guestToken, subject, { type: "existing", workspaceId: guest.workspaceId.toUpperCase() }, UPGRADE_CAPABILITIES,
    ), { code: "GUEST_UPGRADE_TARGET_SAME_AS_SOURCE" });
    await assert.rejects(completeGuestUpgrade(
      guest.guestToken, subject, { type: "existing", workspaceId: targetWorkspaceId.replaceAll("-", "") }, UPGRADE_CAPABILITIES,
    ), { code: "WORKSPACE_NOT_FOUND" });
    let notifyTargetLock = (): void => {};
    const reachedTargetLock = new Promise<void>((resolve) => { notifyTargetLock = resolve; });
    const { completion } = await transactionWithWorkspaceScope({ userId: targetUserId, workspaceId: targetWorkspaceId }, async (writer) => {
      await lockWorkspaceMembershipLifecyclesInExecutor(writer, [targetWorkspaceId]);
      const completion = unsafeTransaction((executor) => completeGuestUpgradeInExecutor({
        query<Row extends pg.QueryResultRow>(sql: string, params: ReadonlyArray<SqlValue>): Promise<pg.QueryResult<Row>> {
          const result = executor.query<Row>(sql, params);
          if (sql === "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1::bigint))" && params[0] === targetWorkspaceId) {
            notifyTargetLock();
          }
          return result;
        },
      }, guest.guestToken, subject, { type: "existing", workspaceId: targetWorkspaceId.toUpperCase() }, UPGRADE_CAPABILITIES));
      await Promise.race([reachedTargetLock, completion.then(() => assert.fail("Completion did not wait for the target lock."))]);
      await writer.query("INSERT INTO ai.workspace_chat_instructions (workspace_id, custom_instructions) VALUES ($1, $2)", [
        targetWorkspaceId, "Concurrent owner rule.",
      ]);
      return { completion };
    });
    const result = await completion;
    workspaceIds.push(result.targetWorkspaceId);
    assert.notEqual(result.targetWorkspaceId, targetWorkspaceId);
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, targetWorkspaceId)).customInstructions, "Concurrent owner rule.");
    assert.equal((await loadWorkspaceChatInstructionsForUser(targetUserId, result.targetWorkspaceId)).customInstructions, "Guest rule.");
  });
});

test("revoked-session replay uses the original requested workspace and the durable resolved workspace", async () => {
  await withGuestUpgradeFixture(() => createBrowserGuestSession(randomUUID(), null), async ({ ownerPool, guest, subject, targetUserId, targetWorkspaceId, workspaceIds }) => {
    const resolvedId = await unsafeTransaction((executor) =>
      createWorkspaceInExecutor(executor, targetUserId, { name: "Recovered guest", cause: "explicit" }));
    workspaceIds.push(resolvedId);
    const session = await ownerPool.query<Readonly<{ session_id: string }>>(
      "UPDATE auth.guest_sessions SET revoked_at = now() WHERE user_id = $1 RETURNING session_id",
      [guest.userId],
    );
    const sessionId = session.rows[0]?.session_id;
    assert.ok(sessionId);
    await ownerPool.query(
      "INSERT INTO auth.guest_upgrade_history (upgrade_id, source_guest_user_id, source_guest_workspace_id, source_guest_session_id, source_guest_session_secret_hash, target_subject_user_id, target_user_id, target_workspace_id, selection_type, requested_existing_workspace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'existing',$9)",
      [randomUUID(), guest.userId, guest.workspaceId, sessionId, hashGuestToken(guest.guestToken), subject, targetUserId, resolvedId, targetWorkspaceId],
    );
    assert.deepEqual(await loadBrowserGuestSession(guest.guestToken), {
      status: "pending_upgrade", sessionId, userId: guest.userId, workspaceId: null, purpose: null, platform: null, replayOnly: true,
    });
    assert.deepEqual(await prepareBrowserGuestUpgrade(guest.guestToken, subject, null), {
      mode: "merge_required", demoOnlyDestinationWorkspaceId: targetWorkspaceId,
    });
    const selection = { type: "existing", workspaceId: targetWorkspaceId } as const;
    const replay = await completeBrowserGuestUpgrade(guest.guestToken, subject, selection, UPGRADE_CAPABILITIES);
    assert.equal(replay.outcome, "idempotent_replay");
    assert.equal(replay.workspace.workspaceId, resolvedId);
    await assert.rejects(
      completeBrowserGuestUpgrade(guest.guestToken, subject, { ...selection, workspaceId: resolvedId }, UPGRADE_CAPABILITIES),
      { code: "GUEST_UPGRADE_SELECTION_MISMATCH" },
    );
  });
});
