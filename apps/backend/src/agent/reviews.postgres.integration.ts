import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AuthError } from "../auth";
import { resetAuthConfigForTests } from "../auth/config";
import { createCard, getCard } from "../cards";
import { createDeck } from "../decks";
import { createMcpServer } from "../mcp/server";
import { createAgentRoutes } from "../routes/agent";
import type { AppEnv } from "../server/app";
import { createPublicHttpErrorDetails, HttpError } from "../shared/errors";
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  type ReviewRating,
  type ReviewableCardScheduleState,
} from "../scheduling";
import { defaultWorkspaceSchedulerConfig } from "../scheduling/workspaceConfig";
import { processSyncPull } from "../sync/replication/hotPull";
import { processSyncReviewHistoryPull } from "../sync/replication/reviewHistory";
import { createAgentApiKeyForUser } from "./apiKeys";
import { ensureAgentSyncReplica } from "./syncIdentity";
import type { AgentReviewCardFilter, AgentReviewInput } from "./reviewContract";
import {
  nextReviewCard,
  type AgentReviewResult,
} from "./reviews";

const ratingNames = ["Again", "Hard", "Good", "Easy"] as const;
const reviewedTimeZone = "Europe/Sofia";
const allCards: AgentReviewCardFilter = { kind: "allCards" };

type SeededSchedule = Readonly<{
  state: ReviewableCardScheduleState;
  dueAt: Date;
}>;

/** Replays a rating prefix through the real scheduler to obtain a persistable pre-review state. */
function seedScheduleState(
  cardId: string,
  prefix: ReadonlyArray<ReviewRating>,
  baseTime: number,
): SeededSchedule {
  let state = createEmptyReviewableCardScheduleState(cardId);
  let dueAt = new Date(baseTime);
  for (const [index, rating] of prefix.entries()) {
    const schedule = computeReviewSchedule(
      state,
      defaultWorkspaceSchedulerConfig,
      rating,
      new Date(baseTime + index * 86400_000),
    );
    state = { cardId, ...schedule };
    dueAt = schedule.dueAt;
  }

  return { state, dueAt };
}

test("agent reviews select, filter, and schedule cards the way the first-party clients do", async (t) => {
  assert.ok(
    process.env.TEST_DATABASE_ADMIN_URL,
    "Run with npm run test:postgres-integration",
  );
  const owner = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_ADMIN_URL,
  });
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const seedReplicaId = randomUUID();
  const previousAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = "cognito";
  resetAuthConfigForTests();
  const app = new Hono<AppEnv>();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json(
        {
          error: error.message,
          code: error.code,
          details: createPublicHttpErrorDetails(error.details) ?? undefined,
        },
        error.statusCode as 400,
      );
    }
    if (error instanceof AuthError) {
      return context.json(
        { error: error.message, code: "AUTH_REQUIRED" },
        error.statusCode as 400,
      );
    }
    throw error;
  });
  app.route("/", createAgentRoutes({ allowedOrigins: [] }));

  try {
    const setup = await owner.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [
        userId,
      ]);
      await setup.query(
        "INSERT INTO org.workspaces (workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id) VALUES ($1, 'Agent review integration', $2, $3, 'seed')",
        [workspaceId, "2026-01-01T00:00:00.000Z", seedReplicaId],
      );
      await setup.query(
        "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [workspaceId, userId],
      );
      await setup.query(
        "INSERT INTO sync.workspace_replicas (replica_id, workspace_id, user_id, actor_kind, actor_key, platform, app_version) VALUES ($1, $2, $3, 'workspace_seed', 'workspace-seed', 'system', 'test')",
        [seedReplicaId, workspaceId, userId],
      );
      await setup.query(
        "UPDATE org.user_settings SET workspace_id = $1, progress_time_zone = 'Europe/Sofia' WHERE user_id = $2",
        [workspaceId, userId],
      );
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }
    const { apiKey, connection } = await createAgentApiKeyForUser(
      userId,
      "Review integration",
    );
    const actor = {
      userId,
      workspaceId,
      connectionId: connection.connectionId,
    };
    const replicaId = await ensureAgentSyncReplica(
      workspaceId,
      userId,
      connection.connectionId,
    );
    const post = (
      action: string,
      body: unknown,
      token: string | null = apiKey,
    ) =>
      app.request(`/agent/reviews/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token === null ? {} : { Authorization: `ApiKey ${token}` }),
        },
        body: JSON.stringify(body),
      });
    const postWithoutBody = (action: string) =>
      app.request(`/agent/reviews/${action}`, {
        method: "POST",
        headers: { Authorization: `ApiKey ${apiKey}` },
      });
    const readCode = async (response: Response): Promise<string> =>
      ((await response.json()) as { code: string }).code;
    const makeCard = (
      tags: ReadonlyArray<string>,
      createdAt: string,
    ) =>
      createCard(
        userId,
        workspaceId,
        { frontText: "Question only?", backText: "Secret answer", tags },
        {
          clientUpdatedAt: createdAt,
          lastModifiedByReplicaId: replicaId,
          lastOperationId: randomUUID(),
        },
      );
    const submit = async (
      input: AgentReviewInput,
    ): Promise<AgentReviewResult> => {
      const response = await post("submit", input);
      assert.equal(response.status, 200, await response.clone().text());
      return ((await response.json()) as { data: AgentReviewResult }).data;
    };
    const tombstoneEveryCard = () =>
      owner.query(
        "UPDATE content.cards SET deleted_at = now() WHERE workspace_id = $1 AND deleted_at IS NULL",
        [workspaceId],
      );
    const scheduleCard = (
      cardId: string,
      dueAt: string,
      lastReviewedAt: string,
    ) =>
      owner.query(
        [
          "UPDATE content.cards SET due_at = $2, fsrs_last_reviewed_at = $3,",
          "reps = 1, lapses = 0, fsrs_card_state = 'review', fsrs_step_index = NULL,",
          "fsrs_stability = 10, fsrs_difficulty = 5, fsrs_scheduled_days = 1",
          "WHERE card_id = $1",
        ].join(" "),
        [cardId, dueAt, lastReviewedAt],
      );

    await t.test(
      "the queue puts recently reviewed due cards first, then other due cards, then new cards",
      async () => {
        await tombstoneEveryCard();
        const now = Date.now();
        const at = (minutes: number) =>
          new Date(now + minutes * 60_000).toISOString();
        const recentEarly = await makeCard([], "2026-01-02T00:00:00.000Z");
        await scheduleCard(recentEarly.cardId, at(-120), at(-30));
        const tieLeft = await makeCard([], "2026-01-03T00:00:00.000Z");
        await scheduleCard(tieLeft.cardId, at(-60), at(-30));
        const tieRight = await makeCard([], "2026-01-03T00:00:00.000Z");
        await scheduleCard(tieRight.cardId, at(-60), at(-45));
        const longOverdue = await makeCard([], "2026-01-04T00:00:00.000Z");
        await scheduleCard(longOverdue.cardId, at(-600), at(-90));
        const future = await makeCard([], "2026-01-05T00:00:00.000Z");
        await scheduleCard(future.cardId, at(60), at(-30));
        const newOlder = await makeCard([], "2026-01-01T00:00:00.000Z");
        const newYounger = await makeCard([], "2026-01-06T00:00:00.000Z");

        const drained: Array<string> = [];
        for (;;) {
          const next = await nextReviewCard(actor, allCards);
          if (next.card === null) {
            break;
          }
          drained.push(next.card.cardId);
          await owner.query(
            "UPDATE content.cards SET deleted_at = now() WHERE card_id = $1",
            [next.card.cardId],
          );
        }

        assert.deepEqual(drained, [
          recentEarly.cardId,
          ...[tieLeft.cardId, tieRight.cardId].sort(),
          longOverdue.cardId,
          newOlder.cardId,
          newYounger.cardId,
        ]);
        assert.equal(drained.includes(future.cardId), false);
      },
    );

    await t.test(
      "tags match any of, a deck resolves to its tags, and both empty inputs keep their asymmetry",
      async () => {
        await tombstoneEveryCard();
        const alpha = await makeCard(["alpha"], "2026-02-01T00:00:00.000Z");
        const beta = await makeCard(["beta"], "2026-02-02T00:00:00.000Z");
        const untagged = await makeCard([], "2026-02-03T00:00:00.000Z");
        const deckMetadata = {
          clientUpdatedAt: "2026-02-01T00:00:00.000Z",
          lastModifiedByReplicaId: replicaId,
          lastOperationId: randomUUID(),
        };
        const betaDeck = await createDeck(
          userId,
          workspaceId,
          {
            name: "Beta",
            filterDefinition: { version: 2, tags: ["beta"] },
          },
          deckMetadata,
        );
        const everythingDeck = await createDeck(
          userId,
          workspaceId,
          {
            name: "Everything",
            filterDefinition: { version: 2, tags: [] },
          },
          { ...deckMetadata, lastOperationId: randomUUID() },
        );

        const firstCardId = async (
          filter: AgentReviewCardFilter,
        ): Promise<string | null> =>
          (await nextReviewCard(actor, filter)).card?.cardId ?? null;
        assert.equal(await firstCardId(allCards), alpha.cardId);
        assert.equal(
          await firstCardId({ kind: "tags", tags: ["beta"] }),
          beta.cardId,
        );
        assert.equal(
          await firstCardId({ kind: "tags", tags: ["beta", "alpha"] }),
          alpha.cardId,
        );
        assert.equal(await firstCardId({ kind: "tags", tags: ["absent"] }), null);
        // An explicitly empty tag filter selects nothing, while a deck without tags selects everything.
        assert.equal(await firstCardId({ kind: "tags", tags: [] }), null);
        assert.equal(
          await firstCardId({ kind: "deck", deckId: betaDeck.deckId }),
          beta.cardId,
        );
        assert.equal(
          await firstCardId({ kind: "deck", deckId: everythingDeck.deckId }),
          alpha.cardId,
        );
        await owner.query(
          "UPDATE content.cards SET deleted_at = now() WHERE card_id = ANY($1::uuid[])",
          [[alpha.cardId, beta.cardId]],
        );
        assert.equal(await firstCardId({ kind: "tags", tags: ["alpha", "beta"] }), null);
        assert.equal(
          await firstCardId({ kind: "deck", deckId: everythingDeck.deckId }),
          untagged.cardId,
        );
        assert.equal(
          (await post("next", { tags: ["beta"], deckId: betaDeck.deckId }))
            .status,
          400,
        );
        assert.equal(
          (await post("next", { deckId: randomUUID() })).status,
          404,
        );
      },
    );

    await t.test(
      "every rating from new, learning, review, and relearning uses the workspace scheduler at server time",
      async () => {
        const baseTime = Date.now() - 7 * 86400_000;
        for (const [stateName, prefix] of [
          ["new", []],
          ["learning", [0]],
          ["review", [3]],
          ["relearning", [3, 0]],
        ] as const) {
          for (const rating of [0, 1, 2, 3] as const) {
            const card = await makeCard([], "2026-03-01T00:00:00.000Z");
            const seeded = seedScheduleState(card.cardId, prefix, baseTime);
            assert.equal(seeded.state.fsrsCardState, stateName);
            if (prefix.length > 0) {
              await owner.query(
                [
                  "UPDATE content.cards SET due_at = $2, reps = $3, lapses = $4, fsrs_card_state = $5,",
                  "fsrs_step_index = $6, fsrs_stability = $7, fsrs_difficulty = $8,",
                  "fsrs_last_reviewed_at = $9, fsrs_scheduled_days = $10 WHERE card_id = $1",
                ].join(" "),
                [
                  card.cardId,
                  seeded.dueAt,
                  seeded.state.reps,
                  seeded.state.lapses,
                  seeded.state.fsrsCardState,
                  seeded.state.fsrsStepIndex,
                  seeded.state.fsrsStability,
                  seeded.state.fsrsDifficulty,
                  seeded.state.fsrsLastReviewedAt,
                  seeded.state.fsrsScheduledDays,
                ],
              );
            }

            const result = await submit({
              cardId: card.cardId,
              reviewId: randomUUID(),
              rating: ratingNames[rating],
              reviewedTimeZone,
            });
            const persisted = await getCard(userId, workspaceId, card.cardId);
            // The server owns the review instant, so the schedule is verified against the
            // instant it stamped rather than against anything the request could have supplied.
            // That instant is also the card's LWW clock, so a later client snapshot can only
            // overwrite this review when it genuinely postdates it.
            assert.equal(result.reviewedAt, persisted.fsrsLastReviewedAt);
            assert.equal(result.reviewedAt, persisted.clientUpdatedAt);
            const reviewedAt = new Date(result.reviewedAt);
            const expected = computeReviewSchedule(
              seeded.state,
              defaultWorkspaceSchedulerConfig,
              rating,
              reviewedAt,
            );
            assert.equal(result.rating, ratingNames[rating]);
            assert.equal(result.dueAt, expected.dueAt.toISOString());
            assert.equal(
              result.intervalSeconds,
              (expected.dueAt.getTime() - reviewedAt.getTime()) / 1000,
            );
            assert.equal(result.scheduledDays, expected.fsrsScheduledDays);
            assert.equal(result.state, expected.fsrsCardState);
            assert.equal(result.reps, expected.reps);
            assert.equal(result.lapses, expected.lapses);
            assert.equal("backText" in result, false);
            assert.equal(persisted.fsrsStability, expected.fsrsStability);
            assert.equal(persisted.fsrsDifficulty, expected.fsrsDifficulty);
            assert.equal(persisted.fsrsStepIndex, expected.fsrsStepIndex);
          }
        }
      },
    );

    const retryCard = await makeCard([], "2026-04-01T00:00:00.000Z");
    const retryInput: AgentReviewInput = {
      workspaceId,
      cardId: retryCard.cardId,
      reviewId: randomUUID(),
      rating: "Good",
      reviewedTimeZone,
    };
    let original: AgentReviewResult;

    await t.test(
      "a retried submission reports the stored schedule and records nothing twice",
      async () => {
        original = await submit(retryInput);
        const retry = await post("submit", retryInput);
        assert.equal(retry.status, 409);
        const body = (await retry.json()) as {
          code: string;
          details?: { reviewSchedule?: Record<string, unknown> };
        };
        assert.equal(body.code, "REVIEW_EVENT_CONFLICT");
        assert.deepEqual(body.details?.reviewSchedule, {
          cardId: retryCard.cardId,
          dueAt: original.dueAt,
          intervalSeconds: original.intervalSeconds,
          scheduledDays: original.scheduledDays,
          state: original.state,
          reps: original.reps,
          lapses: original.lapses,
        });
        const counts = await owner.query(
          "SELECT (SELECT count(*) FROM content.review_events WHERE card_id = $1) AS events, (SELECT count(*) FROM sync.hot_changes WHERE entity_id = $1::text AND operation_id = $2) AS changes",
          [retryCard.cardId, `agent-review:${retryInput.reviewId}`],
        );
        assert.deepEqual(counts.rows[0], { events: "1", changes: "1" });
        const persisted = await getCard(userId, workspaceId, retryCard.cardId);
        assert.equal(persisted.reps, original.reps);
        assert.equal(persisted.dueAt, original.dueAt);
        const progress = await owner.query(
          "SELECT (SELECT count(*) FROM content.review_events WHERE reviewed_by_user_id = $1) AS events, (SELECT sum(review_count) FROM progress.user_active_review_days WHERE reviewed_by_user_id = $1) AS progress",
          [userId],
        );
        assert.equal(progress.rows[0].events, progress.rows[0].progress);
      },
    );

    await t.test(
      "a card whose last review is not in the past is stale, unless this reviewId's review already landed",
      async () => {
        const card = await makeCard([], "2026-04-02T00:00:00.000Z");
        const landedInput: AgentReviewInput = {
          cardId: card.cardId,
          reviewId: randomUUID(),
          rating: "Good",
          reviewedTimeZone,
        };
        const landed = await submit(landedInput);
        const injectedDueAt = "2026-04-02T06:00:00.000Z";
        await owner.query(
          "UPDATE content.cards SET fsrs_last_reviewed_at = now() + interval '1 hour', due_at = $2 WHERE card_id = $1",
          [card.cardId, injectedDueAt],
        );
        const stale = await post("submit", {
          ...landedInput,
          reviewId: randomUUID(),
        });
        assert.equal(stale.status, 409);
        assert.equal(await readCode(stale), "REVIEW_STALE");
        // The stored review instant sits in the future, but this reviewId's review already landed,
        // so the retry is owed the card's schedule rather than a staleness report it cannot act on.
        const retry = await post("submit", landedInput);
        assert.equal(retry.status, 409);
        const body = (await retry.json()) as {
          code: string;
          details?: { reviewSchedule?: Record<string, unknown> };
        };
        assert.equal(body.code, "REVIEW_EVENT_CONFLICT");
        assert.equal(body.details?.reviewSchedule?.cardId, card.cardId);
        assert.equal(body.details?.reviewSchedule?.dueAt, injectedDueAt);
        // due_at was injected behind the future review instant, so the schedule describes no
        // interval whatever the scheduler's learning steps are.
        assert.equal(body.details?.reviewSchedule?.intervalSeconds, null);
        assert.equal(body.details?.reviewSchedule?.reps, landed.reps);
        assert.equal((await getCard(userId, workspaceId, card.cardId)).reps, 1);
      },
    );

    await t.test(
      "the contract owns the clock, requires a timezone, and accepts a body-less read",
      async () => {
        for (const patch of [
          { reviewedAtClient: "2026-04-03T09:00:00.000Z" },
          { reviewedTimeZone: undefined },
          { reviewedTimeZone: "Invalid/Zone" },
          { rating: "perfectly remembered" },
          { rating: "good" },
          { fsrsStability: 100 },
        ]) {
          const response = await post("submit", {
            ...retryInput,
            reviewId: randomUUID(),
            ...patch,
          });
          assert.equal(response.status, 400, JSON.stringify(patch));
          assert.equal(await readCode(response), "REVIEW_INPUT_INVALID");
        }
        assert.equal((await postWithoutBody("next")).status, 200);
        assert.equal((await postWithoutBody("reveal")).status, 400);
      },
    );

    await t.test(
      "the committed review reaches both the hot and the review-history sync lanes",
      async () => {
        const installationId = randomUUID();
        const hot = await processSyncPull(workspaceId, userId, {
          installationId,
          platform: "web",
          afterHotChangeId: 0,
          limit: 100,
        });
        const history = await processSyncReviewHistoryPull(workspaceId, userId, {
          installationId,
          platform: "web",
          afterReviewSequenceId: 0,
          limit: 100,
        });
        assert.match(JSON.stringify(hot), new RegExp(retryCard.cardId));
        assert.match(JSON.stringify(hot), /agent-review:/);
        assert.match(
          JSON.stringify(history),
          new RegExp(original!.reviewEventId),
        );
      },
    );

    await t.test(
      "MCP publishes the strict schemas, keeps the answer behind reveal, and honours the filters",
      async () => {
        const server = createMcpServer(
          { ...actor, selectedWorkspaceId: workspaceId },
          "https://mcp.example.test/mcp",
          "https://example.test",
          "https://example.test/icon.svg",
          { caller: "review-test", recordInvokedTool: () => {} },
        );
        const client = new Client({ name: "voice-client-test", version: "1" });
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        try {
          const tools = (await client.listTools()).tools;
          const submitTool = tools.find(
            (entry) => entry.name === "submit_review",
          )!;
          assert.deepEqual(submitTool.annotations, {
            readOnlyHint: false,
            destructiveHint: true,
            openWorldHint: false,
            idempotentHint: true,
          });
          assert.deepEqual(submitTool.inputSchema.required, [
            "cardId",
            "reviewId",
            "rating",
            "reviewedTimeZone",
          ]);
          assert.equal(submitTool.inputSchema.additionalProperties, false);
          assert.deepEqual(
            (submitTool.inputSchema.properties!.rating as { enum: string[] })
              .enum,
            ratingNames,
          );
          const nextTool = tools.find(
            (entry) => entry.name === "next_review_card",
          )!;
          assert.ok(nextTool.inputSchema.properties?.tags);
          assert.ok(nextTool.inputSchema.properties?.deckId);
          assert.equal(nextTool.inputSchema.additionalProperties, false);

          await tombstoneEveryCard();
          const tagged = await makeCard(["mcp"], "2026-05-01T00:00:00.000Z");
          const question = await client.callTool({
            name: "next_review_card",
            arguments: { workspaceId, tags: ["mcp"] },
          });
          assert.equal(question.isError, undefined);
          assert.match(JSON.stringify(question), new RegExp(tagged.cardId));
          assert.doesNotMatch(JSON.stringify(question), /Secret answer/);
          const answer = await client.callTool({
            name: "reveal_answer",
            arguments: { workspaceId, cardId: tagged.cardId },
          });
          assert.match(JSON.stringify(answer), /Secret answer/);
          for (const invalid of [
            { tags: ["mcp"], deckId: randomUUID() },
            { workspaceId: "invalid" },
          ]) {
            assert.equal(
              (
                await client.callTool({
                  name: "next_review_card",
                  arguments: { workspaceId, ...invalid },
                })
              ).isError,
              true,
            );
          }
          for (const sql of [
            `UPDATE cards SET fsrs_stability = 100 WHERE card_id = '${tagged.cardId}'`,
            "INSERT INTO review_events (rating) VALUES (3)",
          ]) {
            assert.equal(
              (
                await client.callTool({
                  name: "sql_execute",
                  arguments: { workspaceId, sql },
                })
              ).isError,
              true,
            );
          }
          const denied = await client.callTool({
            name: "submit_review",
            arguments: {
              workspaceId: randomUUID(),
              cardId: tagged.cardId,
              reviewId: randomUUID(),
              rating: "Good",
              reviewedTimeZone,
            },
          });
          assert.equal(denied.isError, true);
          assert.doesNotMatch(JSON.stringify(denied), /Secret answer/);
        } finally {
          await client.close();
          await server.close();
        }
      },
    );

    await t.test(
      "authentication, membership, and workspace boundaries apply to every action",
      async () => {
        const card = await makeCard([], "2026-06-01T00:00:00.000Z");
        const submitBody: AgentReviewInput = {
          cardId: card.cardId,
          reviewId: randomUUID(),
          rating: "Good",
          reviewedTimeZone,
        };
        for (const action of ["next", "reveal", "submit"]) {
          const body =
            action === "next"
              ? {}
              : action === "reveal"
                ? { cardId: card.cardId }
                : submitBody;
          assert.equal((await post(action, body, null)).status, 401);
          assert.equal(
            (await post(action, { ...body, workspaceId: randomUUID() })).status,
            404,
          );
        }
        const strangerId = randomUUID();
        await owner.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [
          strangerId,
        ]);
        try {
          const stranger = await createAgentApiKeyForUser(strangerId, "Stranger");
          assert.equal(
            (await post("submit", submitBody, stranger.apiKey)).status,
            404,
          );
          // Verify RLS separately from the HTTP membership preflight.
          assert.deepEqual(
            await nextReviewCard({ ...actor, userId: strangerId }, allCards),
            { workspaceId, card: null },
          );
        } finally {
          await owner.query(
            "DELETE FROM org.workspaces WHERE workspace_id IN (SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1)",
            [strangerId],
          );
          await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [
            strangerId,
          ]);
        }
        await owner.query(
          "DELETE FROM org.workspace_memberships WHERE user_id = $1 AND workspace_id = $2",
          [userId, workspaceId],
        );
        assert.equal((await post("submit", submitBody)).status, 404);
        await owner.query(
          "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [workspaceId, userId],
        );
        await owner.query(
          "UPDATE auth.agent_api_keys SET revoked_at = now() WHERE connection_id = $1",
          [connection.connectionId],
        );
        assert.equal((await post("submit", submitBody)).status, 401);
      },
    );
  } finally {
    const cleanup = await owner.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query(
        "DELETE FROM org.workspaces WHERE workspace_id = $1 OR workspace_id IN (SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $2)",
        [workspaceId, userId],
      );
      await cleanup.query("DELETE FROM org.user_settings WHERE user_id = $1", [
        userId,
      ]);
      await cleanup.query("COMMIT");
    } finally {
      cleanup.release();
      await owner.end();
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
      resetAuthConfigForTests();
    }
  }
});
