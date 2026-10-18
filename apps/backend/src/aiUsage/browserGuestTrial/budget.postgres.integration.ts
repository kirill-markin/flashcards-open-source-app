import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import { ensureUserProfileInExecutor } from "../../auth/ensureUser";
import { lockAccountLifecyclesInExecutor, bindCognitoIdentityMappingInExecutor } from "../../auth/userIdentities";
import { prepareChatRun } from "../../chat/runs/lifecycleService";
import type { PreparedChatRun } from "../../chat/runs/types";
import { forgetBrowserGuestSession } from "../../guestAuth/browser/session";
import { authenticateGuestSession } from "../../guestAuth/session";
import { hashGuestToken } from "../../guestAuth/shared";
import { deleteUserSettingsInExecutor } from "../../guestAuth/store/deletion";
import { prepareBrowserGuestUpgradeInExecutor } from "../../guestAuth/upgrade";
import { HttpError, createPublicHttpErrorDetails } from "../../shared/errors";
import { withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import {
  anonymizeAiUsageForDeletedPersonInExecutor,
  transferAiUsageToUpgradedAccountInExecutor,
} from "../identity";
import type { BrowserGuestTrialContext } from "./policy";
import type { BrowserGuestAiTrialStatus } from "./contract";
import { createBrowserGuestChatOperation, reserveNewBrowserGuestTrialOperation, startBrowserGuestTrialProvider } from "./admission";
import {
  loadBrowserGuestAiTrialStatus,
  readBrowserGuestAiTrialInExecutor,
  reserveBrowserGuestAiTrialInExecutor,
  releaseBrowserGuestAiTrialOnProvenNoCallInExecutor,
  startBrowserGuestAiTrialProviderInExecutor,
  type BrowserGuestTrialOperation,
} from "./repository";

function guestContext(userId: string): BrowserGuestTrialContext {
  return { userId, guestSessionId: randomUUID(), transport: "guest", guestPlatform: "web",
    guestSessionPurpose: "browser_product", guestCredentialSource: "cookie" };
}

async function insertGuestSession(pool: pg.Pool, context: BrowserGuestTrialContext): Promise<string> {
  const token = randomUUID();
  await pool.query(`INSERT INTO auth.guest_sessions (session_id, session_secret_hash, user_id, platform, purpose)
    VALUES ($1, $2, $3, 'web', 'browser_product')`, [context.guestSessionId, hashGuestToken(token), context.userId]);
  const authenticated = await authenticateGuestSession(token);
  assert.equal(authenticated.userId, context.userId);
  assert.equal(authenticated.sessionId, context.guestSessionId);
  assert.equal(authenticated.purpose, context.guestSessionPurpose);
  assert.equal(authenticated.platform, context.guestPlatform);
  return token;
}

function operation(feature: BrowserGuestTrialOperation["feature"], units: number): BrowserGuestTrialOperation {
  return { operationId: randomUUID(), feature, units, payloadSha256: "a".repeat(64) };
}

async function inScope<Result>(
  pool: pg.Pool,
  context: BrowserGuestTrialContext,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  const executor: DatabaseExecutor = { query: (text, params) => client.query(text, [...params]) };
  try {
    await client.query("BEGIN");
    await applyUserDatabaseScopeInExecutor(executor, { userId: context.userId });
    const result = await callback(executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function quota(scope: "guest" | "shared", feature: "chat" | "dictation" | "images"): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "BROWSER_GUEST_AI_TRIAL_QUOTA_REACHED");
    const details = createPublicHttpErrorDetails(error.details)?.browserGuestAiTrial;
    assert.equal(details?.scope, scope);
    assert.equal(details?.feature, feature);
    if (scope === "guest") assert.equal(details?.resetsAt, null);
    else assert.match(details?.resetsAt ?? "", /T00:00:00\.000Z$/);
    return true;
  };
}

async function assertLifecycleWaiters(pool: pg.Pool, blockerPid: number, expected: number): Promise<void> {
  let waiting = 0;
  for (let attempt = 0; attempt < 100 && waiting !== expected; attempt += 1) {
    const result = await pool.query<Readonly<{ waiting: number }>>(`SELECT count(*)::INTEGER AS waiting
      FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND wait_event = 'advisory'
      AND query LIKE 'SELECT pg_advisory_xact_lock_shared(hashtextextended(''auth.account:''%'
      AND NOT EXISTS (SELECT 1 FROM pg_locks WHERE pg_locks.pid = pg_stat_activity.pid
        AND locktype = 'relation' AND relation IN ('ai.chat_sessions'::regclass, 'ai.chat_runs'::regclass))`, [blockerPid]);
    waiting = result.rows[0]?.waiting ?? 0;
    if (waiting !== expected) await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(waiting, expected, "Trial wrappers must wait on lifecycle before touching chat rows");
}

test("browser guest budgets atomically reserve, bind replays, preserve daily consumption and expose only scoped reads", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const guest = guestContext(fixture.userId);
    const other = guestContext(`${fixture.userId}-other`);
    const anonymous = randomUUID();
    const owners = [guest.userId, other.userId, anonymous];
    const reserve = (op: BrowserGuestTrialOperation) => inScope(fixture.runtimePool, guest,
      (executor) => reserveBrowserGuestAiTrialInExecutor(executor, guest, op));
    try {
      await fixture.ownerPool.query("INSERT INTO org.user_settings(user_id) VALUES ($1)", [other.userId]);
      await insertGuestSession(fixture.ownerPool, guest);
      await insertGuestSession(fixture.ownerPool, other);
      const initial = await inScope(fixture.runtimePool, guest,
        (executor) => readBrowserGuestAiTrialInExecutor(executor, guest));
      assert.equal(initial.version, 1);
      assert.equal(initial.enabled, true);
      assert.equal(initial.maxRecordingSeconds, 120);
      assert.deepEqual(initial.chat, { lifetimeLimit: 5, lifetimeRemaining: 5,
        sharedDailyLimit: 100, sharedAvailable: true });
      assert.equal(initial.dictation.lifetimeRemaining, 1800);
      assert.equal(initial.images.lifetimeRemaining, 5);
      assert.match(initial.sharedResetsAt, /T00:00:00\.000Z$/);

      // Four old-day reservations consume lifetime units even though the shared day has renewed.
      await fixture.ownerPool.query(`INSERT INTO ai.browser_guest_trial_reservations
        (operation_id,user_id,feature,units,payload_sha256,budget_day)
        SELECT gen_random_uuid()::TEXT,$1,'chat',1,repeat('b',64),
          (clock_timestamp() AT TIME ZONE 'UTC')::DATE - 1 FROM generate_series(1,4)`, [guest.userId]);
      const last = operation("chat", 1);
      const rival = operation("chat", 1);
      const race = await Promise.allSettled([reserve(last), reserve(rival)]);
      assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
      const denied = race.find((result) => result.status === "rejected");
      assert.ok(denied?.status === "rejected");
      quota("guest", "chat")(denied.reason);
      const winner = race[0]?.status === "fulfilled" ? last : rival;
      assert.deepEqual(await reserve(winner), { outcome: "duplicate", state: "reserved" });
      await assert.rejects(reserve({ ...winner, payloadSha256: "c".repeat(64) }),
        { code: "BROWSER_GUEST_AI_TRIAL_OPERATION_CONFLICT" });
      await assert.rejects(reserve({ ...winner, feature: "images" }),
        { code: "BROWSER_GUEST_AI_TRIAL_OPERATION_CONFLICT" });
      await assert.rejects(inScope(fixture.runtimePool, other,
        (executor) => reserveBrowserGuestAiTrialInExecutor(executor, other, winner)),
      { code: "BROWSER_GUEST_AI_TRIAL_OPERATION_CONFLICT" });
      await inScope(fixture.runtimePool, guest,
        (executor) => startBrowserGuestAiTrialProviderInExecutor(executor, guest, winner));
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => startBrowserGuestAiTrialProviderInExecutor(executor, guest, winner)),
      { code: "BROWSER_GUEST_AI_TRIAL_PROVIDER_OUTCOME_UNKNOWN" });
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => releaseBrowserGuestAiTrialOnProvenNoCallInExecutor(executor, guest, winner)),
      { code: "BROWSER_GUEST_AI_TRIAL_RELEASE_REFUSED" });

      const voice = operation("dictation", 120);
      await reserve(voice);
      await assert.rejects(reserve({ ...voice, units: 119 }),
        { code: "BROWSER_GUEST_AI_TRIAL_OPERATION_CONFLICT" });
      await inScope(fixture.runtimePool, guest,
        (executor) => releaseBrowserGuestAiTrialOnProvenNoCallInExecutor(executor, guest, voice));
      assert.deepEqual(await reserve(voice), { outcome: "duplicate", state: "released_no_call" });
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => startBrowserGuestAiTrialProviderInExecutor(executor, guest, voice)),
      { code: "BROWSER_GUEST_AI_TRIAL_PROVIDER_OUTCOME_UNKNOWN" });
      await assert.rejects(reserve(operation("dictation", 121)), { code: "23514" });
      await fixture.ownerPool.query(`INSERT INTO ai.browser_guest_trial_reservations
        (operation_id,user_id,feature,units,payload_sha256,budget_day)
        SELECT gen_random_uuid()::TEXT,$1,'dictation',120,repeat('b',64),
          (clock_timestamp() AT TIME ZONE 'UTC')::DATE - 1 FROM generate_series(1,15)`, [guest.userId]);
      await assert.rejects(reserve(operation("dictation", 1)), quota("guest", "dictation"));

      // A rolled-back caller transaction must not keep a reservation.
      const rolledBack = operation("images", 1);
      await assert.rejects(inScope(fixture.runtimePool, guest, async (executor) => {
        await reserveBrowserGuestAiTrialInExecutor(executor, guest, rolledBack);
        throw new Error("rollback run creation");
      }), /rollback run creation/);
      assert.equal((await reserve(rolledBack)).outcome, "reserved");

      await fixture.ownerPool.query(`INSERT INTO ai.browser_guest_trial_reservations
        (operation_id,user_id,feature,units,payload_sha256,budget_day)
        SELECT gen_random_uuid()::TEXT,$1,'images',1,repeat('b',64),
          (clock_timestamp() AT TIME ZONE 'UTC')::DATE FROM generate_series(1,98)`, [other.userId]);
      const sharedRace = await Promise.allSettled([reserve(operation("images", 1)), reserve(operation("images", 1))]);
      assert.equal(sharedRace.filter((result) => result.status === "fulfilled").length, 1);
      const sharedDenied = sharedRace.find((result) => result.status === "rejected");
      assert.ok(sharedDenied?.status === "rejected");
      quota("shared", "images")(sharedDenied.reason);
      const before = await inScope(fixture.runtimePool, guest,
        (executor) => readBrowserGuestAiTrialInExecutor(executor, guest));
      assert.equal(before.images.sharedAvailable, false);
      assert.equal(before.dictation.lifetimeRemaining, 0);
      await assert.rejects(fixture.runtimePool.query("SELECT * FROM ai.browser_guest_trial_reservations"),
        { code: "42501" });
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => readBrowserGuestAiTrialInExecutor(executor, other)), /scoped to the authenticated owner/);
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => reserveBrowserGuestAiTrialInExecutor(executor,
          { ...guest, guestCredentialSource: "authorization" }, operation("images", 1))),
      { code: "BROWSER_GUEST_AI_TRIAL_INELIGIBLE" });
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => reserveBrowserGuestAiTrialInExecutor(executor,
          { ...guest, guestSessionId: null }, operation("images", 1))),
      { code: "BROWSER_GUEST_AI_TRIAL_INELIGIBLE" });
      await assert.rejects(inScope(fixture.runtimePool, guest,
        (executor) => reserveBrowserGuestAiTrialInExecutor(executor,
          { ...guest, guestSessionId: other.guestSessionId }, operation("images", 1))),
      { code: "P0A01" });

      await inScope(fixture.runtimePool, guest, (executor) => transferAiUsageToUpgradedAccountInExecutor(
        executor, guest.userId, fixture.workspaceId, other.userId, fixture.workspaceId));
      await inScope(fixture.runtimePool, other, async (executor) => {
        const transferred = await readBrowserGuestAiTrialInExecutor(executor, other);
        assert.equal(transferred.chat.lifetimeRemaining, 0);
        assert.equal(transferred.images.sharedAvailable, false);
        assert.equal((await reserveBrowserGuestAiTrialInExecutor(executor, other, winner)).outcome, "duplicate");
      });
      // The private proved-account union uses a separate SQL entrypoint from guest upgrade.
      await fixture.ownerPool.query("SELECT ai.transfer_account_usage($1, $2)", [other.userId, guest.userId]);
      await inScope(fixture.runtimePool, guest, async (executor) => {
        assert.equal((await readBrowserGuestAiTrialInExecutor(executor, guest)).chat.lifetimeRemaining, 0);
        await anonymizeAiUsageForDeletedPersonInExecutor(executor, [guest.userId, other.userId], anonymous);
      });
      const erased = await fixture.ownerPool.query<Readonly<{ total: number; linked: number }>>(`SELECT
        sum(units) FILTER (WHERE feature='images' AND state<>'released_no_call')::INTEGER AS total,
        count(*) FILTER (WHERE operation_id=$2 OR payload_sha256<>repeat('0',64))::INTEGER AS linked
        FROM ai.browser_guest_trial_reservations WHERE user_id=$1`, [anonymous, winner.operationId]);
      assert.equal(erased.rows[0]?.total, 100);
      assert.equal(erased.rows[0]?.linked, 0);
      const after = await inScope(fixture.runtimePool, guest,
        (executor) => readBrowserGuestAiTrialInExecutor(executor, guest));
      assert.equal(after.images.sharedAvailable, false);
    } finally {
      await fixture.ownerPool.query("DELETE FROM ai.browser_guest_trial_reservations WHERE user_id=ANY($1::TEXT[])", [owners]);
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id=$1", [other.userId]);
    }
  });
});

test("ordinary guest profile contention waits before trial reads, provider starts and chat admission", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const guest = guestContext(fixture.userId);
    const token = await insertGuestSession(fixture.ownerPool, guest);
    const image = operation("images", 1);
    const requestId = randomUUID();
    let allowanceChecks = 0;
    const reserveChat = async (executor: DatabaseExecutor, sessionId: string): Promise<void> => {
      allowanceChecks += 1;
      await reserveNewBrowserGuestTrialOperation(executor, guest, createBrowserGuestChatOperation(sessionId, requestId));
    };
    const prepare = (sessionId: string | undefined) => prepareChatRun(
      guest.userId, fixture.workspaceId, sessionId, [{ type: "text", text: "Guest lifecycle contention" }],
      requestId, "UTC", null, false, "web", null, null, reserveChat, null, guest,
    );
    const blocker = await fixture.runtimePool.connect();
    const executor: DatabaseExecutor = { query: (text, params) => blocker.query(text, [...params]) };
    const pending: Array<Promise<BrowserGuestAiTrialStatus | PreparedChatRun | null | void>> = [];
    try {
      await inScope(fixture.runtimePool, guest,
        (scoped) => reserveBrowserGuestAiTrialInExecutor(scoped, guest, image));
      await blocker.query("BEGIN");
      await applyUserDatabaseScopeInExecutor(executor, { userId: guest.userId });
      await ensureUserProfileInExecutor(executor, guest.userId, null);
      const pid = (await blocker.query<Readonly<{ pid: number }>>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      assert.ok(pid !== undefined);
      const read = loadBrowserGuestAiTrialStatus(guest);
      const start = startBrowserGuestTrialProvider(guest, image);
      const admission = prepare(undefined);
      pending.push(read, start, admission);
      const settled = Promise.allSettled(pending);
      await assertLifecycleWaiters(fixture.ownerPool, pid, 3);
      assert.equal(allowanceChecks, 0);
      const before = await fixture.ownerPool.query<Readonly<{ state: string }>>(
        "SELECT state FROM ai.browser_guest_trial_reservations WHERE operation_id = $1", [image.operationId]);
      assert.equal(before.rows[0]?.state, "reserved");
      await blocker.query("COMMIT");
      for (const result of await settled) {
        if (result.status === "rejected") throw result.reason;
      }
      assert.ok(await read);
      await start;
      const run = await admission;
      assert.equal(run.deduplicated, false);
      assert.equal(run.browserGuestAiTrial, true);
      assert.equal(allowanceChecks, 1);
      const replay = await prepare(run.sessionId);
      assert.equal(replay.runId, run.runId);
      assert.equal(replay.deduplicated, true);
      assert.equal(allowanceChecks, 1);
      await assert.rejects(startBrowserGuestTrialProvider(guest, image),
        { code: "BROWSER_GUEST_AI_TRIAL_PROVIDER_OUTCOME_UNKNOWN" });
      const after = await loadBrowserGuestAiTrialStatus(guest);
      assert.equal(after?.chat.lifetimeRemaining, 4);
      assert.equal(after?.images.lifetimeRemaining, 4);
      const receipts = await fixture.ownerPool.query<Readonly<{ total: number; started: number }>>(`SELECT
        count(*)::INTEGER AS total, count(*) FILTER (WHERE state='provider_started')::INTEGER AS started
        FROM ai.browser_guest_trial_reservations WHERE user_id = $1`, [guest.userId]);
      assert.deepEqual(receipts.rows[0], { total: 2, started: 1 });

      await blocker.query("BEGIN");
      await applyUserDatabaseScopeInExecutor(executor, { userId: guest.userId });
      await ensureUserProfileInExecutor(executor, guest.userId, null);
      const forgottenRead = loadBrowserGuestAiTrialStatus(guest);
      const forgottenStart = startBrowserGuestTrialProvider(guest, createBrowserGuestChatOperation(run.sessionId, requestId));
      pending.push(forgottenRead, forgottenStart);
      const refused = Promise.allSettled([forgottenRead, forgottenStart]);
      await assertLifecycleWaiters(fixture.ownerPool, pid, 2);
      await forgetBrowserGuestSession(token);
      await blocker.query("COMMIT");
      await refused;
      await assert.rejects(forgottenRead, { code: "ACCOUNT_SCOPE_CHANGED" });
      await assert.rejects(forgottenStart, { code: "ACCOUNT_SCOPE_CHANGED" });
      assert.deepEqual((await fixture.ownerPool.query<Readonly<{ state: string }>>(
        "SELECT state FROM ai.browser_guest_trial_reservations WHERE operation_id=$1",
        [createBrowserGuestChatOperation(run.sessionId, requestId).operationId],
      )).rows, [{ state: "reserved" }]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled(pending);
      await fixture.ownerPool.query("DELETE FROM ai.browser_guest_trial_reservations WHERE user_id=$1", [guest.userId]);
    }
  });
});

test("stale browser guest authorization cannot reserve or start providers after merge, binding or revocation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const merged = guestContext(`${fixture.userId}-merged`);
    const bound = guestContext(`${fixture.userId}-bound`);
    const revoked = guestContext(`${fixture.userId}-revoked`);
    const registered: BrowserGuestTrialContext = { userId: fixture.userId, transport: "session", guestSessionId: null,
      guestPlatform: null, guestSessionPurpose: null, guestCredentialSource: null };
    const guests = [merged, bound, revoked];
    const owners = [registered.userId, ...guests.map((guest) => guest.userId)];
    const mergedReservation = operation("chat", 1);
    const boundReservation = operation("chat", 1);
    const revokedReservation = operation("chat", 1);
    const reservations = [mergedReservation, boundReservation, revokedReservation];
    try {
      await fixture.ownerPool.query("INSERT INTO org.user_settings(user_id) SELECT unnest($1::TEXT[])",
        [guests.map((guest) => guest.userId)]);
      await inScope(fixture.runtimePool, registered, (executor) =>
        bindCognitoIdentityMappingInExecutor(executor, randomUUID(), registered.userId));
      await insertGuestSession(fixture.ownerPool, merged);
      const boundToken = await insertGuestSession(fixture.ownerPool, bound);
      await insertGuestSession(fixture.ownerPool, revoked);
      for (const [guest, reservation] of [
        [merged, mergedReservation], [bound, boundReservation], [revoked, revokedReservation],
      ] as const) {
        await inScope(fixture.runtimePool, guest, (executor) => reserveBrowserGuestAiTrialInExecutor(executor, guest, reservation));
      }

      // Authorization and the transaction scope predate the completed merge; READ COMMITTED must
      // recheck the deleted source even though neither tombstone registry records guest cleanup.
      await inScope(fixture.runtimePool, merged, async (staleExecutor) => {
        await inScope(fixture.runtimePool, registered, async (executor) => {
          await lockAccountLifecyclesInExecutor(executor, [merged.userId, registered.userId]);
          await transferAiUsageToUpgradedAccountInExecutor(executor, merged.userId, fixture.workspaceId,
            registered.userId, fixture.workspaceId);
          await deleteUserSettingsInExecutor(executor, merged.userId);
        });
        await assert.rejects(reserveBrowserGuestAiTrialInExecutor(staleExecutor, merged, operation("chat", 1)),
          { code: "P0A01" });
      });
      await assert.rejects(inScope(fixture.runtimePool, merged, (executor) =>
        startBrowserGuestAiTrialProviderInExecutor(executor, merged, mergedReservation)), { code: "P0A01" });
      await assert.rejects(inScope(fixture.runtimePool, merged, (executor) =>
        readBrowserGuestAiTrialInExecutor(executor, merged)), { code: "P0A01" });

      await inScope(fixture.runtimePool, bound, async (staleExecutor) => {
        await inScope(fixture.runtimePool, bound, (executor) =>
          prepareBrowserGuestUpgradeInExecutor(executor, boundToken, randomUUID(), null));
        await assert.rejects(startBrowserGuestAiTrialProviderInExecutor(staleExecutor, bound, boundReservation),
          { code: "P0A01" });
      });
      await assert.rejects(inScope(fixture.runtimePool, bound, (executor) =>
        reserveBrowserGuestAiTrialInExecutor(executor, bound, operation("chat", 1))), { code: "P0A01" });
      await assert.rejects(authenticateGuestSession(boundToken), { code: "GUEST_BROWSER_UPGRADE_REQUIRED" });

      await fixture.ownerPool.query("UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1",
        [revoked.guestSessionId]);
      await assert.rejects(inScope(fixture.runtimePool, revoked, (executor) =>
        reserveBrowserGuestAiTrialInExecutor(executor, revoked, operation("chat", 1))), { code: "P0A01" });
      await assert.rejects(inScope(fixture.runtimePool, revoked, (executor) =>
        startBrowserGuestAiTrialProviderInExecutor(executor, revoked, revokedReservation)), { code: "P0A01" });
      const receipts = await fixture.ownerPool.query<Readonly<{ user_id: string; state: string }>>(
        "SELECT user_id, state FROM ai.browser_guest_trial_reservations WHERE user_id=ANY($1::TEXT[]) ORDER BY operation_id",
        [owners]);
      assert.equal(receipts.rowCount, reservations.length);
      assert.ok(receipts.rows.every((row) => row.state === "reserved"));
      assert.ok(receipts.rows.some((row) => row.user_id === registered.userId));
      assert.ok(receipts.rows.every((row) => row.user_id !== merged.userId));
    } finally {
      await fixture.ownerPool.query("DELETE FROM ai.browser_guest_trial_reservations WHERE user_id=ANY($1::TEXT[])", [owners]);
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::TEXT[])",
        [guests.map((guest) => guest.userId)]);
    }
  });
});
