import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import { type DatabaseExecutor } from "../../database";
import { appendAiUsageEvent, type AiUsageEvent } from "../../aiUsage/record";
import { resolveAiUsageOwnerInExecutor } from "../../aiUsage/identity";
import { getAiUsageMonthWindow, loadAiUsageMessagesForMonth, loadAiUsageWeightedTokensForMonth } from "../../aiUsage/cap";
import { assertAccountLiveSession } from "../../auth/principalSessions";
import { withPostgresIntegrationFixture } from "../../testSupport/postgresIntegration";
import { assertTrustedChatWorkerInvocation } from "../worker/invoke";
import { convertLegacyAttachmentsBeforeClaim } from "../worker";
import { CHAT_RUN_INTERRUPTED_ERROR } from "../terminalErrors";
import {
  claimChatRun,
  failQueuedChatRun,
  markQueuedChatRunDispatchFailed,
  touchClaimedChatRunHeartbeat,
} from "./lifecycleService";
import { resolveTrustedChatWorkerOwner, transactionWithChatWorkerOwnerScope } from "./ownerScope";

type RunFixture = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  requestId: string;
}>;

function executorFor(client: pg.PoolClient): DatabaseExecutor {
  return { query: (text, params) => client.query(text, [...params]) };
}

async function insertQueuedRun(
  owner: pg.Pool,
  userId: string,
  workspaceId: string,
): Promise<RunFixture> {
  const run = {
    runId: randomUUID(), sessionId: randomUUID(), assistantItemId: randomUUID(), requestId: randomUUID(),
  };
  await owner.query(
    "INSERT INTO ai.chat_sessions(session_id,user_id,workspace_id,status,active_run_id) VALUES ($1,$2,$3,'running',$4)",
    [run.sessionId, userId, workspaceId, run.runId],
  );
  await owner.query(
    "INSERT INTO ai.chat_items(item_id,session_id,item_kind,state,payload) VALUES ($1,$2,'message','in_progress',$3::jsonb)",
    [run.assistantItemId, run.sessionId, JSON.stringify({ role: "assistant", content: [] })],
  );
  await owner.query(
    `INSERT INTO ai.chat_runs(run_id,session_id,assistant_item_id,status,request_id,model_id,reasoning_effort,timezone,turn_input)
     VALUES ($1,$2,$3,'queued',$4,'gpt-5.6-terra','xhigh','UTC','[]'::jsonb)`,
    [run.runId, run.sessionId, run.assistantItemId, run.requestId],
  );
  return run;
}

function usageEvent(
  userId: string,
  workspaceId: string,
  occurredAt: Date,
  requestId: string,
): AiUsageEvent {
  return {
    userId, workspaceId, occurredAt, requestId,
    surface: "chat", provider: "openai", modelId: "gpt-5.6-terra", tierAtCall: "free",
    counters: {
      inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2,
      reasoningTokens: 5, audioSeconds: null,
    },
    imageCount: null, imageSize: null, imageQuality: null, userSuppliedKey: false,
  };
}

test("trusted chat and usage retain immutable identity while authorization follows the canonical account", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const source = fixture.userId;
    const target = randomUUID();
    const foreign = randomUUID();
    const subject = randomUUID();
    const subjectHash = createHash("sha256").update(subject).digest("hex");
    const receipt = randomUUID();
    const accounts = [source, target, foreign];
    const sessions: Array<string> = [];
    const month = new Date("2026-09-15T12:00:00.000Z");
    const priorMonth = new Date("2026-08-15T12:00:00.000Z");
    const originalIssuedAt = Math.floor(Date.now() / 1_000);
    const owner = await fixture.ownerPool.connect();
    const contender = await fixture.runtimePool.connect();
    try {
      await owner.query("SET statement_timeout = '3s'");
      await contender.query("SET statement_timeout = '3s'");
      await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1),($2)", [target, foreign]);
      await owner.query("SELECT auth.bind_cognito_account($1,$2)", [subject, source]);
      await owner.query("INSERT INTO auth.cognito_principals(cognito_subject,cognito_username) VALUES ($1,$1)", [subject]);
      const running = await insertQueuedRun(fixture.ownerPool, source, fixture.workspaceId);
      const queued = await insertQueuedRun(fixture.ownerPool, source, fixture.workspaceId);
      const dispatchFailed = await insertQueuedRun(fixture.ownerPool, source, fixture.workspaceId);
      const prepareFailed = await insertQueuedRun(fixture.ownerPool, source, fixture.workspaceId);
      sessions.push(...[running, queued, dispatchFailed, prepareFailed].map((run) => run.sessionId));
      const invocation = Object.freeze({
        userId: source, workspaceId: fixture.workspaceId, ...queued,
      });
      const originalInvocation = JSON.stringify(invocation);
      assertTrustedChatWorkerInvocation(invocation);
      assert.throws(() => assertTrustedChatWorkerInvocation({ ...invocation, runId: "" }));
      await assert.rejects(resolveTrustedChatWorkerOwner(
        source, fixture.workspaceId, queued.runId, running.sessionId, queued.requestId,
      ), /does not match its persisted run/);
      assert.equal(await claimChatRun(foreign, fixture.workspaceId, queued.runId), null);
      const initialClaim = await claimChatRun(source, fixture.workspaceId, running.runId);
      assert.ok(initialClaim);
      const initialLease = initialClaim.claimToken;

      await appendAiUsageEvent(usageEvent(source, fixture.workspaceId, month, running.requestId));
      await appendAiUsageEvent(usageEvent(source, fixture.workspaceId, priorMonth, randomUUID()));
      await appendAiUsageEvent(usageEvent(target, fixture.workspaceId, month, randomUUID()));
      const history = (await owner.query(
        "SELECT * FROM ai.usage_events WHERE user_id = ANY($1::text[]) ORDER BY usage_event_id", [[source, target]],
      )).rows;
      assert.equal(history.length, 3);

      // Independent contender owns the actual append fence. Retirement cannot pass it.
      await contender.query("BEGIN");
      assert.equal(await resolveAiUsageOwnerInExecutor(executorFor(contender), source), source);
      await owner.query("BEGIN");
      await assert.rejects(owner.query(
        "SELECT auth.record_account_retirement($1,$2,$3)", [source, target, receipt],
      ), { code: "P0A01" });
      await owner.query("ROLLBACK");
      await contender.query("ROLLBACK");

      // Conversely a private retirement in progress refuses both boundaries before any callback SQL.
      await owner.query("BEGIN");
      await owner.query("SELECT auth.lock_account_retirement($1,$2)", [source, target]);
      let callbackRan = false;
      await assert.rejects(transactionWithChatWorkerOwnerScope(source, fixture.workspaceId, async () => {
        callbackRan = true;
      }), { code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409 });
      assert.equal(callbackRan, false);
      const countBeforeRefusal = (await owner.query(
        "SELECT count(*)::int AS count FROM ai.usage_events WHERE user_id = ANY($1::text[])", [[source, target]],
      )).rows[0].count;
      await appendAiUsageEvent(usageEvent(source, fixture.workspaceId, month, randomUUID()));
      assert.equal((await owner.query(
        "SELECT count(*)::int AS count FROM ai.usage_events WHERE user_id = ANY($1::text[])", [[source, target]],
      )).rows[0].count, countBeforeRefusal);
      await owner.query("ROLLBACK");

      const preflightOwner = await resolveTrustedChatWorkerOwner(
        invocation.userId, invocation.workspaceId, invocation.runId, invocation.sessionId, invocation.requestId,
      );
      assert.ok(preflightOwner);
      assert.equal(preflightOwner, source);

      // Test-only owner privileges model the future atomic transfer; runtime has no retirement grant.
      await owner.query("BEGIN");
      await owner.query("SELECT auth.record_account_retirement($1,$2,$3)", [source, target, receipt]);
      await owner.query("UPDATE org.workspace_memberships SET user_id=$2 WHERE user_id=$1", [source, target]);
      await owner.query("UPDATE sync.workspace_replicas SET user_id=$2 WHERE user_id=$1", [source, target]);
      await owner.query("UPDATE ai.chat_sessions SET user_id=$2 WHERE user_id=$1", [source, target]);
      await owner.query("UPDATE ai.usage_events SET user_id=$2 WHERE user_id=$1", [source, target]);
      await owner.query("COMMIT");
      assert.deepEqual((await owner.query(
        "SELECT * FROM ai.usage_events WHERE user_id=$1 ORDER BY usage_event_id", [target],
      )).rows, history.map((row) => ({ ...row, user_id: target })));

      // Retirement committed after preflight and before the real preparation/failure adapter opens its scope.
      const executionContext = { lambdaRequestId: null, getRemainingTimeInMillis: () => 30_000 };
      await assert.rejects(convertLegacyAttachmentsBeforeClaim(invocation, preflightOwner, executionContext), {
        code: "ACCOUNT_SCOPE_CHANGED", statusCode: 409,
      });
      assert.deepEqual((await owner.query(
        `SELECT r.run_id,r.session_id,r.request_id,r.status,r.worker_claimed_at::text AS claim_token,
                r.finished_at,r.last_error_message,s.user_id,s.status AS session_status,s.active_run_id,
                i.state AS assistant_state
         FROM ai.chat_runs r JOIN ai.chat_sessions s ON s.session_id=r.session_id
         JOIN ai.chat_items i ON i.item_id=r.assistant_item_id WHERE r.run_id=$1`,
        [invocation.runId],
      )).rows, [{
        run_id: queued.runId, session_id: queued.sessionId, request_id: queued.requestId,
        status: "queued", claim_token: null, finished_at: null, last_error_message: null,
        user_id: target, session_status: "running", active_run_id: queued.runId, assistant_state: "in_progress",
      }]);
      assert.equal(JSON.stringify(invocation), originalInvocation);
      const nextOwner = await resolveTrustedChatWorkerOwner(
        invocation.userId, invocation.workspaceId, invocation.runId, invocation.sessionId, invocation.requestId,
      );
      assert.ok(nextOwner);
      assert.equal(nextOwner, target);
      await convertLegacyAttachmentsBeforeClaim(invocation, nextOwner, executionContext);
      assert.equal(await resolveTrustedChatWorkerOwner(
        foreign, fixture.workspaceId, queued.runId, queued.sessionId, queued.requestId,
      ), null);
      const claim = await claimChatRun(invocation.userId, invocation.workspaceId, invocation.runId);
      assert.ok(claim);
      assert.equal(claim.userId, target);
      assert.equal(claim.runId, queued.runId);
      assert.equal(claim.sessionId, queued.sessionId);
      assert.equal(claim.requestId, queued.requestId);
      assert.equal(JSON.stringify(invocation), originalInvocation);
      assert.equal(await claimChatRun(source, fixture.workspaceId, queued.runId), null);
      assert.deepEqual(await touchClaimedChatRunHeartbeat(
        target, fixture.workspaceId, running.runId, initialLease, new Date(),
      ), { cancellationRequested: false, ownershipLost: false });
      assert.equal((await owner.query(
        "SELECT worker_claimed_at::text AS token FROM ai.chat_runs WHERE run_id=$1", [running.runId],
      )).rows[0].token, initialLease);
      await markQueuedChatRunDispatchFailed(source, fixture.workspaceId, dispatchFailed.runId);
      assert.equal(await failQueuedChatRun(source, fixture.workspaceId, prepareFailed.runId, { code: null, message: "conversion rejected" }), true);
      assert.equal(await failQueuedChatRun(source, fixture.workspaceId, prepareFailed.runId, { code: null, message: "repeat" }), false);
      assert.deepEqual((await owner.query(
        "SELECT run_id,status,last_error_message FROM ai.chat_runs WHERE run_id=ANY($1::uuid[]) ORDER BY run_id",
        [[dispatchFailed.runId, prepareFailed.runId]],
      )).rows, [
        { run_id: dispatchFailed.runId, status: "interrupted", last_error_message: CHAT_RUN_INTERRUPTED_ERROR.message },
        { run_id: prepareFailed.runId, status: "failed", last_error_message: "conversion rejected" },
      ].sort((left, right) => left.run_id.localeCompare(right.run_id)));

      await appendAiUsageEvent(usageEvent(source, fixture.workspaceId, month, queued.requestId));
      assert.equal(await loadAiUsageWeightedTokensForMonth(target, getAiUsageMonthWindow(month)), 159);
      assert.deepEqual(await loadAiUsageMessagesForMonth(target, getAiUsageMonthWindow(month)), {
        platformKeyMessages: 3, ownKeyMessages: 0,
      });
      assert.equal(await loadAiUsageWeightedTokensForMonth(source, getAiUsageMonthWindow(month)), 0);
      const appended = (await owner.query(
        "SELECT * FROM ai.usage_events WHERE request_id=$1", [queued.requestId],
      )).rows;
      assert.equal(appended.length, 1);
      assert.equal(appended[0].user_id, target);
      assert.equal(appended[0].workspace_id, fixture.workspaceId);
      assert.equal(appended[0].input_tokens, "11");
      assert.equal(appended[0].output_tokens, "7");

      // The signed account and issue time stay original; the validator returns authorization separately.
      assert.equal(await assertAccountLiveSession(source, originalIssuedAt), target);
      await owner.query(
        "INSERT INTO auth.principal_session_fences(subject_sha256,minimum_auth_time) VALUES ($1,$2)",
        [subjectHash, originalIssuedAt + 1],
      );
      await assert.rejects(assertAccountLiveSession(source, originalIssuedAt), { code: "SESSION_REVOKED" });
      assert.equal(await assertAccountLiveSession(source, originalIssuedAt + 1), target);
      await owner.query("INSERT INTO auth.deleted_accounts(user_id_sha256) VALUES ($1)", [
        createHash("sha256").update(source).digest("hex"),
      ]);
      await assert.rejects(assertAccountLiveSession(source, originalIssuedAt + 1), { code: "ACCOUNT_DELETED" });
    } finally {
      await Promise.all([owner.query("ROLLBACK"), contender.query("ROLLBACK")]);
      await owner.query("DELETE FROM auth.account_retirements WHERE retired_user_id=$1", [source]);
      await owner.query("DELETE FROM auth.principal_session_fences WHERE subject_sha256=$1", [subjectHash]);
      await owner.query("DELETE FROM auth.deleted_accounts WHERE user_id_sha256=$1", [
        createHash("sha256").update(source).digest("hex"),
      ]);
      await owner.query("DELETE FROM ai.chat_sessions WHERE session_id=ANY($1::uuid[])", [sessions]);
      await owner.query("DELETE FROM ai.usage_events WHERE user_id=ANY($1::text[])", [accounts]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id=ANY($1::text[])", [[target, foreign]]);
      await owner.query("DELETE FROM auth.cognito_principals WHERE cognito_subject=$1", [subject]);
      await owner.query("RESET statement_timeout");
      await contender.query("RESET statement_timeout");
      owner.release();
      contender.release();
    }
  });
});
