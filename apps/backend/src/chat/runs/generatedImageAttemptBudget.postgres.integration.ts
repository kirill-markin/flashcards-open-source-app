import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  bindGeneratedCardImageAttemptPayload,
  markGeneratedCardImageProviderStarted,
  reserveGeneratedCardImageAttempt,
  reserveGeneratedCardImageAttemptWithExecutor,
  type GeneratedCardImageAttemptReservation,
  type GeneratedCardImageAttemptReservationParams,
} from "../openai/tools/generatedImageAttemptBudget";
import { HttpError } from "../../shared/errors";
import {
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
} from "../store/messageService";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../testSupport/postgresIntegration";
import {
  claimChatRun,
  prepareChatRun,
  reconcileInactiveClaimedChatRun,
} from "./lifecycleService";

type ChatRunFixture = Readonly<{
  sessionId: string;
  runId: string;
  assistantItemId: string;
  claimToken: string;
}>;

type ClaimTokenRow = Readonly<{ claim_token: string }>;
type AssistantPayloadRow = Readonly<{
  payload: Readonly<{
    content?: unknown;
    generatedCardImageAttemptCount?: unknown;
    generatedCardImageOperations?: unknown;
    reservationSentinel?: unknown;
  }>;
}>;

async function createChatRunFixture(
  fixture: PostgresIntegrationFixture,
): Promise<ChatRunFixture> {
  const sessionId = randomUUID();
  const runId = randomUUID();
  const assistantItemId = randomUUID();
  const claimTimestamp = new Date(Date.now() - 60_000).toISOString();
  const client = await fixture.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ai.chat_sessions (
         session_id, user_id, workspace_id, status, active_run_id, active_run_heartbeat_at
       ) VALUES ($1, $2, $3, 'running', NULL, $4)`,
      [sessionId, fixture.userId, fixture.workspaceId, claimTimestamp],
    );
    await client.query(
      `INSERT INTO ai.chat_items (
         item_id, session_id, item_kind, state, payload
       ) VALUES ($1, $2, 'message', 'in_progress', $3::jsonb)`,
      [
        assistantItemId,
        sessionId,
        JSON.stringify({
          role: "assistant",
          content: [{ type: "text", text: "Initial assistant content" }],
          reservationSentinel: { preserved: true },
        }),
      ],
    );
    const insertedRun = await client.query<ClaimTokenRow>(
      `INSERT INTO ai.chat_runs (
         run_id, session_id, assistant_item_id, status, request_id, model_id,
         reasoning_effort, timezone, turn_input, worker_claimed_at,
         worker_heartbeat_at, started_at
       ) VALUES (
         $1, $2, $3, 'running', $4, 'gpt-5.6-terra', 'xhigh', 'Europe/Madrid',
         '[]'::jsonb, $5, $5, $5
       )
       RETURNING worker_claimed_at::text AS claim_token`,
      [runId, sessionId, assistantItemId, `request-${runId}`, claimTimestamp],
    );
    await client.query(
      `UPDATE ai.chat_sessions
       SET active_run_id = $2
       WHERE session_id = $1`,
      [sessionId, runId],
    );
    await client.query("COMMIT");

    const claimToken = insertedRun.rows[0]?.claim_token;
    if (claimToken === undefined) {
      throw new Error(`Chat run fixture did not return a claim token. runId=${runId}`);
    }
    return { sessionId, runId, assistantItemId, claimToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createReservationParams(
  fixture: PostgresIntegrationFixture,
  run: ChatRunFixture,
  claimToken: string,
  operationKey: string,
): GeneratedCardImageAttemptReservationParams {
  return {
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
    runId: run.runId,
    sessionId: run.sessionId,
    claimToken,
    operationKey,
    databaseDeadlineAtMs: Date.now() + 120_000,
  };
}

async function loadAssistantPayload(
  fixture: PostgresIntegrationFixture,
  assistantItemId: string,
): Promise<AssistantPayloadRow["payload"]> {
  const result = await fixture.ownerPool.query<AssistantPayloadRow>(
    "SELECT payload FROM ai.chat_items WHERE item_id = $1",
    [assistantItemId],
  );
  const payload = result.rows[0]?.payload;
  if (payload === undefined) {
    throw new Error(`Assistant payload was not found. assistantItemId=${assistantItemId}`);
  }
  return payload;
}

async function reserveThenRunSentinel(
  params: GeneratedCardImageAttemptReservationParams,
  onReserved: () => void,
): Promise<GeneratedCardImageAttemptReservation> {
  const reservation = await reserveGeneratedCardImageAttempt(params);
  if (reservation.status === "reserved") {
    onReserved();
  }
  return reservation;
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === expectedCode;
}

test("generated image attempt reservations are durable, fenced, and concurrency-safe", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const sequentialRun = await createChatRunFixture(fixture);
    let postReservationCallCount = 0;
    const sequentialResults: Array<GeneratedCardImageAttemptReservation> = [];
    for (let operationIndex = 1; operationIndex <= 4; operationIndex += 1) {
      sequentialResults.push(await reserveThenRunSentinel(
        createReservationParams(
          fixture,
          sequentialRun,
          sequentialRun.claimToken,
          `generated-image:${String(operationIndex)}`,
        ),
        (): void => {
          postReservationCallCount += 1;
        },
      ));
    }
    assert.deepEqual(sequentialResults, [
      { status: "reserved", attempt: 1, payload: null },
      { status: "reserved", attempt: 2, payload: null },
      { status: "reserved", attempt: 3, payload: null },
      { status: "limit_reached" },
    ]);
    assert.equal(postReservationCallCount, 3);
    const sequentialPayload = await loadAssistantPayload(
      fixture,
      sequentialRun.assistantItemId,
    );
    assert.equal(sequentialPayload.generatedCardImageAttemptCount, 3);
    assert.deepEqual(sequentialPayload.reservationSentinel, { preserved: true });

    const concurrentRun = await createChatRunFixture(fixture);
    const concurrentResults = await Promise.all(
      Array.from(
        { length: 4 },
        async (_value, index) => reserveGeneratedCardImageAttempt(
          createReservationParams(
            fixture,
            concurrentRun,
            concurrentRun.claimToken,
            `generated-image:${String(index + 1)}`,
          ),
        ),
      ),
    );
    const concurrentAttempts = concurrentResults.flatMap((result) =>
      result.status === "reserved" ? [result.attempt] : []).sort();
    assert.deepEqual(concurrentAttempts, [1, 2, 3]);
    assert.equal(
      concurrentResults.filter((result) => result.status === "limit_reached").length,
      1,
    );
    assert.equal(
      (await loadAssistantPayload(fixture, concurrentRun.assistantItemId))
        .generatedCardImageAttemptCount,
      3,
    );

    const inactiveRun = await createChatRunFixture(fixture);
    const inactiveParams = createReservationParams(
      fixture,
      inactiveRun,
      inactiveRun.claimToken,
      "generated-image:1",
    );
    assert.deepEqual(await reserveGeneratedCardImageAttempt(inactiveParams), {
      status: "reserved",
      attempt: 1,
      payload: null,
    });
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = now() WHERE run_id = $1",
      [inactiveRun.runId],
    );
    assert.deepEqual(
      await reserveGeneratedCardImageAttempt(inactiveParams),
      { status: "run_inactive" },
    );
    assert.equal(await reconcileInactiveClaimedChatRun(
      fixture.userId, fixture.workspaceId, inactiveParams), "user_cancelled");
    await fixture.ownerPool.query(
      "UPDATE ai.chat_runs SET cancel_requested_at = NULL WHERE run_id = $1",
      [inactiveRun.runId],
    );
    await fixture.ownerPool.query(
      "UPDATE ai.chat_sessions SET status = 'idle', active_run_id = NULL WHERE session_id = $1",
      [inactiveRun.sessionId],
    );
    assert.deepEqual(
      await reserveGeneratedCardImageAttempt(inactiveParams),
      { status: "run_inactive" },
    );
    assert.equal(await reconcileInactiveClaimedChatRun(
      fixture.userId, fixture.workspaceId, inactiveParams), "ownership_lost");
    assert.equal(
      (await loadAssistantPayload(fixture, inactiveRun.assistantItemId))
        .generatedCardImageAttemptCount,
      1,
    );

    const reclaimedRun = await createChatRunFixture(fixture);
    const firstClaimParams = createReservationParams(
      fixture,
      reclaimedRun,
      reclaimedRun.claimToken,
      "generated-image:1",
    );
    assert.deepEqual(await reserveGeneratedCardImageAttempt(firstClaimParams), {
      status: "reserved",
      attempt: 1,
      payload: null,
    });
    const originalPayload = {
      cardId: randomUUID(),
      targetSide: "back" as const,
      imagePrompt: "Original stable prompt",
      altText: "Original stable alt text",
    };
    assert.deepEqual(
      await bindGeneratedCardImageAttemptPayload({
        ...firstClaimParams,
        attempt: 1,
        payload: originalPayload,
      }),
      originalPayload,
    );
    const reclaimedClaim = await claimChatRun(
      fixture.userId,
      fixture.workspaceId,
      reclaimedRun.runId,
    );
    assert.ok(reclaimedClaim);
    assert.notEqual(reclaimedClaim.claimToken, reclaimedRun.claimToken);
    assert.deepEqual(
      await reserveGeneratedCardImageAttempt(firstClaimParams),
      { status: "run_inactive" },
    );
    assert.deepEqual(
      await reserveGeneratedCardImageAttempt(createReservationParams(
        fixture,
        reclaimedRun,
        reclaimedClaim.claimToken,
        "generated-image:1",
      )),
      { status: "reserved", attempt: 1, payload: originalPayload },
    );
    assert.deepEqual(
      await bindGeneratedCardImageAttemptPayload({
        ...createReservationParams(
          fixture,
          reclaimedRun,
          reclaimedClaim.claimToken,
          "generated-image:1",
        ),
        attempt: 1,
        payload: {
          ...originalPayload,
          imagePrompt: "Regenerated wording must not replace the original prompt",
          altText: "Regenerated wording",
        },
      }),
      originalPayload,
    );
    assert.equal(
      (await loadAssistantPayload(fixture, reclaimedRun.assistantItemId))
        .generatedCardImageAttemptCount,
      1,
    );

    const rewriteRun = await createChatRunFixture(fixture);
    const rewriteParams = createReservationParams(
      fixture,
      rewriteRun,
      rewriteRun.claimToken,
      "generated-image:1",
    );
    assert.equal(
      (await reserveGeneratedCardImageAttempt(rewriteParams)).status,
      "reserved",
    );
    const updatedItem = await updateAssistantMessageItem(
      fixture.userId,
      fixture.workspaceId,
      {
        itemId: rewriteRun.assistantItemId,
        content: [{ type: "text", text: "Streaming update" }],
        state: "in_progress",
      },
    );
    assert.equal("generatedCardImageAttemptCount" in updatedItem, false);
    assert.equal(
      (await loadAssistantPayload(fixture, rewriteRun.assistantItemId))
        .generatedCardImageAttemptCount,
      1,
    );
    await updateAssistantMessageItemAndInvalidateMainContent(
      fixture.userId,
      fixture.workspaceId,
      {
        itemId: rewriteRun.assistantItemId,
        content: [{ type: "text", text: "Mutating tool update" }],
        state: "in_progress",
      },
    );
    const rewrittenPayload = await loadAssistantPayload(
      fixture,
      rewriteRun.assistantItemId,
    );
    assert.equal(rewrittenPayload.generatedCardImageAttemptCount, 1);
    assert.deepEqual(rewrittenPayload.generatedCardImageOperations, [{
      operationKey: "generated-image:1",
      attempt: 1,
      payload: null,
    }]);
    assert.deepEqual(rewrittenPayload.content, [
      { type: "text", text: "Mutating tool update" },
    ]);

    await assert.rejects(
      reserveGeneratedCardImageAttempt({
        ...rewriteParams,
        runId: "not-a-uuid",
      }),
      (error: unknown) => hasErrorCode(error, "22P02"),
    );
    await assert.rejects(
      reserveGeneratedCardImageAttempt(
        { ...rewriteParams, databaseDeadlineAtMs: Date.now() - 1 }),
      (error: unknown) => hasErrorCode(error, "DATABASE_DEADLINE_EXCEEDED"),
    );

    const databaseBoundaryError = new HttpError(503, "Database boundary sentinel", "DATABASE_BOUNDARY_SENTINEL");
    await assert.rejects(
      reserveGeneratedCardImageAttemptWithExecutor(
        { query: async () => { throw databaseBoundaryError; } },
        rewriteParams,
      ),
      (error: unknown) => error === databaseBoundaryError
        && databaseBoundaryError.code === "DATABASE_BOUNDARY_SENTINEL",
    );
  });
});

test("generated image provider starts are durable, claim-fenced, and concurrency-safe", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createChatRunFixture(fixture);
    const params = createReservationParams(
      fixture,
      run,
      run.claimToken,
      "generated-image:1",
    );
    assert.deepEqual(await reserveGeneratedCardImageAttempt(params), {
      status: "reserved",
      attempt: 1,
      payload: null,
    });
    const payload = {
      cardId: fixture.cardId,
      targetSide: "back" as const,
      imagePrompt: "Draw a durable provider-start fence.",
      altText: "Durable provider-start fence",
    };
    assert.deepEqual(
      await bindGeneratedCardImageAttemptPayload({
        ...params,
        attempt: 1,
        payload,
      }),
      payload,
    );

    assert.deepEqual(
      (await loadAssistantPayload(fixture, run.assistantItemId))
        .generatedCardImageOperations,
      [{
        operationKey: "generated-image:1",
        attempt: 1,
        payload,
      }],
    );

    const concurrentResults = await Promise.all([
      markGeneratedCardImageProviderStarted(params),
      markGeneratedCardImageProviderStarted(params),
    ]);
    assert.deepEqual(
      concurrentResults.map((result) => result.status).sort(),
      ["first_started", "previously_started"],
    );
    assert.deepEqual(
      (await loadAssistantPayload(fixture, run.assistantItemId))
        .generatedCardImageOperations,
      [{
        operationKey: "generated-image:1",
        attempt: 1,
        payload,
        providerStarted: true,
      }],
    );

    const reclaimed = await claimChatRun(
      fixture.userId,
      fixture.workspaceId,
      run.runId,
    );
    assert.ok(reclaimed);
    assert.notEqual(reclaimed.claimToken, run.claimToken);
    await assert.rejects(
      markGeneratedCardImageProviderStarted(params),
      /Chat run claim is no longer active/u,
    );
    assert.deepEqual(
      await markGeneratedCardImageProviderStarted({
        ...params,
        claimToken: reclaimed.claimToken,
      }),
      { status: "previously_started" },
    );
  });
});

test("chat run deduplication preserves the initiating guest classification after sign-in", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const requestId = randomUUID();
    const content = [{ type: "text" as const, text: "Generate an image." }];
    const guestRun = await prepareChatRun(
      fixture.userId,
      fixture.workspaceId,
      undefined,
      content,
      requestId,
      "Europe/Madrid",
      null,
      false,
    );
    assert.equal(guestRun.initiatingAuthIsSignedIn, false);

    const signedInReplay = await prepareChatRun(
      fixture.userId,
      fixture.workspaceId,
      guestRun.sessionId,
      content,
      requestId,
      "Europe/Madrid",
      null,
      true,
    );
    assert.equal(signedInReplay.deduplicated, true);
    assert.equal(signedInReplay.initiatingAuthIsSignedIn, false);

    const claimed = await claimChatRun(
      fixture.userId,
      fixture.workspaceId,
      guestRun.runId,
    );
    assert.ok(claimed);
    assert.equal(claimed.initiatingAuthIsSignedIn, false);
  });
});
