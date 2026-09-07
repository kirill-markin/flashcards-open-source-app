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
import { createMcpServer } from "../mcp/server";
import { createAgentRoutes } from "../routes/agent";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  type ReviewableCardScheduleState,
} from "../scheduling";
import { defaultWorkspaceSchedulerConfig } from "../scheduling/workspaceConfig";
import { processSyncPull } from "../sync/replication/hotPull";
import { processSyncReviewHistoryPull } from "../sync/replication/reviewHistory";
import { createAgentApiKeyForUser } from "./apiKeys";
import { ensureAgentSyncReplica } from "./syncIdentity";
import type { AgentReviewInput } from "./reviewContract";
import {
  nextReviewCard,
  submitAgentReview,
  type AgentReviewResult,
} from "./reviews";

const ratingNames = ["Again", "Hard", "Good", "Easy"] as const;
const firstReviewAt = "2026-03-08T09:00:00.000Z";

test("agent HTTP and MCP reviews persist through the real scheduler, RLS, and sync lanes", async (t) => {
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
    if (error instanceof HttpError || error instanceof AuthError) {
      return context.json(
        {
          error: error.message,
          code: error instanceof HttpError ? error.code : "AUTH_REQUIRED",
        },
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
    const makeCard = () =>
      createCard(
        userId,
        workspaceId,
        { frontText: "Question only?", backText: "Secret answer", tags: [] },
        {
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
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

    await t.test(
      "all ratings from new, learning, review, and relearning use workspace FSRS settings",
      async () => {
        for (const [stateName, prefix] of [
          ["new", []],
          ["learning", [0]],
          ["review", [3]],
          ["relearning", [3, 0]],
        ] as const) {
          for (const rating of [0, 1, 2, 3] as const) {
            const card = await makeCard();
            let state: ReviewableCardScheduleState =
              createEmptyReviewableCardScheduleState(card.cardId);
            const sequence = [...prefix, rating];
            for (const [index, grade] of sequence.entries()) {
              if (index === sequence.length - 1)
                assert.equal(state.fsrsCardState, stateName);
              const at = new Date(
                new Date(firstReviewAt).getTime() + index * 86400_000,
              );
              const expected = computeReviewSchedule(
                state,
                defaultWorkspaceSchedulerConfig,
                grade,
                at,
              );
              const result = await submit({
                cardId: card.cardId,
                reviewId: randomUUID(),
                rating: ratingNames[grade],
                reviewedAtClient: at.toISOString(),
                reviewedTimeZone: "Europe/Sofia",
              });
              assert.equal(result.dueAt, expected.dueAt.toISOString());
              assert.equal(
                result.intervalSeconds,
                (expected.dueAt.getTime() - at.getTime()) / 1000,
              );
              assert.equal(result.scheduledDays, expected.fsrsScheduledDays);
              assert.equal(result.state, expected.fsrsCardState);
              assert.equal(result.reps, expected.reps);
              assert.equal(result.lapses, expected.lapses);
              assert.equal("backText" in result, false);
              const persisted = await getCard(userId, workspaceId, card.cardId);
              assert.equal(persisted.fsrsStability, expected.fsrsStability);
              assert.equal(persisted.fsrsDifficulty, expected.fsrsDifficulty);
              assert.equal(persisted.fsrsStepIndex, expected.fsrsStepIndex);
              state = { cardId: card.cardId, ...expected };
            }
          }
        }
      },
    );

    await t.test(
      "custom multi-step relearning settings remain authoritative",
      async () => {
        await owner.query(
          "UPDATE org.workspaces SET fsrs_learning_steps_minutes = '[3,9]'::jsonb, fsrs_relearning_steps_minutes = '[2,12]'::jsonb, fsrs_enable_fuzz = false WHERE workspace_id = $1",
          [workspaceId],
        );
        try {
          const card = await makeCard();
          const base: AgentReviewInput = {
            workspaceId,
            cardId: card.cardId,
            reviewId: randomUUID(),
            rating: "Good",
            reviewedAtClient: firstReviewAt,
          };
          assert.equal((await submit(base)).intervalSeconds, 9 * 60);
          assert.equal(
            (
              await submit({
                ...base,
                reviewId: randomUUID(),
                rating: "Easy",
                reviewedAtClient: "2026-03-08T09:09:00.000Z",
              })
            ).state,
            "review",
          );
          const again = await submit({
            ...base,
            reviewId: randomUUID(),
            rating: "Again",
            reviewedAtClient: "2026-03-09T09:00:00.000Z",
          });
          assert.equal(again.state, "relearning");
          assert.equal(again.intervalSeconds, 2 * 60);
          assert.equal(again.lapses, 1);
          const good = await submit({
            ...base,
            reviewId: randomUUID(),
            reviewedAtClient: "2026-03-09T09:02:00.000Z",
          });
          assert.equal(good.state, "relearning");
          assert.equal(good.intervalSeconds, 12 * 60);
          const graduated = await submit({
            ...base,
            reviewId: randomUUID(),
            reviewedAtClient: "2026-03-09T09:14:00.000Z",
          });
          assert.equal(graduated.state, "review");
          assert.equal(graduated.lapses, 1);
        } finally {
          await owner.query(
            "UPDATE org.workspaces SET fsrs_learning_steps_minutes = '[1,10]'::jsonb, fsrs_relearning_steps_minutes = '[10]'::jsonb, fsrs_enable_fuzz = true WHERE workspace_id = $1",
            [workspaceId],
          );
        }
      },
    );

    const retryCard = await makeCard();
    const retryInput: AgentReviewInput = {
      workspaceId,
      cardId: retryCard.cardId,
      reviewId: randomUUID(),
      rating: "Good",
      reviewedAtClient: firstReviewAt,
      reviewedTimeZone: "Europe/Sofia",
    };
    let original: AgentReviewResult;
    await t.test(
      "concurrent retries return exactly one receipt, event, hot change, and progress count",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 5 }, () => submit(retryInput)),
        );
        original = results[0];
        for (const result of results) assert.deepEqual(result, original);
        const counts = await owner.query(
          "SELECT (SELECT count(*) FROM content.review_events WHERE card_id = $1) AS events, (SELECT count(*) FROM sync.hot_changes WHERE entity_id = $1::text AND operation_id = $2) AS changes, (SELECT count(*) FROM sync.agent_review_receipts WHERE workspace_id = $3 AND review_id = $4) AS receipts",
          [
            retryCard.cardId,
            `agent-review:${retryInput.reviewId}`,
            workspaceId,
            retryInput.reviewId,
          ],
        );
        assert.deepEqual(counts.rows[0], {
          events: "1",
          changes: "1",
          receipts: "1",
        });
        const progress = await owner.query(
          "SELECT (SELECT count(*) FROM content.review_events WHERE reviewed_by_user_id = $1) AS events, (SELECT sum(review_count) FROM progress.user_active_review_days WHERE reviewed_by_user_id = $1) AS progress",
          [userId],
        );
        assert.equal(progress.rows[0].events, progress.rows[0].progress);
        const latest = await submit({
          ...retryInput,
          reviewId: randomUUID(),
          rating: "Easy",
          reviewedAtClient: "2026-03-09T09:00:00.000Z",
        });
        assert.equal(latest.reps, 2);
        assert.deepEqual(await submit(retryInput), original);
        for (const patch of [
          { rating: "Again" },
          { cardId: randomUUID() },
          { reviewedAtClient: "2026-03-08T09:00:01.000Z" },
          { reviewedTimeZone: "UTC" },
        ]) {
          const response = await post("submit", { ...retryInput, ...patch });
          assert.equal(response.status, 409);
          assert.equal(
            ((await response.json()) as { code: string }).code,
            "REVIEW_ID_CONFLICT",
          );
        }
      },
    );

    await t.test(
      "normal hot pull and history pull expose the committed review",
      async () => {
        const installationId = randomUUID();
        const hot = await processSyncPull(workspaceId, userId, {
          installationId,
          platform: "web",
          afterHotChangeId: 0,
          limit: 100,
        });
        const history = await processSyncReviewHistoryPull(
          workspaceId,
          userId,
          {
            installationId,
            platform: "web",
            afterReviewSequenceId: 0,
            limit: 100,
          },
        );
        assert.match(JSON.stringify(hot), new RegExp(retryCard.cardId));
        assert.match(JSON.stringify(hot), /agent-review:/);
        assert.match(
          JSON.stringify(history),
          new RegExp(original!.reviewEventId),
        );
      },
    );

    await t.test(
      "invalid inputs and stale reviews fail without advancing history",
      async () => {
        for (const patch of [
          { rating: 2 },
          { rating: "perfectly remembered" },
          { rating: "good" },
          { reviewId: "" },
          { cardId: "invalid" },
          { reviewedAtClient: "2026-02-30T10:00:00Z" },
          { reviewedAtClient: "2026-09-07" },
          { reviewedTimeZone: "Invalid/Zone" },
          { fsrsStability: 100 },
          { reviewedAtServer: firstReviewAt },
        ]) {
          assert.equal(
            (await post("submit", { ...retryInput, ...patch })).status,
            400,
            JSON.stringify(patch),
          );
        }
        assert.equal(
          (await post("submit", { ...retryInput, reviewId: undefined })).status,
          400,
        );
        assert.equal(
          (await post("submit", { ...retryInput, reviewId: randomUUID() }))
            .status,
          409,
        );
        assert.equal(
          (
            await post("submit", {
              ...retryInput,
              reviewId: randomUUID(),
              reviewedAtClient: new Date(Date.now() + 3600_000).toISOString(),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post("submit", {
              ...retryInput,
              reviewId: randomUUID(),
              cardId: randomUUID(),
            })
          ).status,
          404,
        );
        assert.equal(
          (await getCard(userId, workspaceId, retryCard.cardId)).reps,
          2,
        );
      },
    );

    await t.test(
      "LWW ties and existing event identities cannot reschedule a card",
      async () => {
        const card = await makeCard();
        const input: AgentReviewInput = {
          ...retryInput,
          cardId: card.cardId,
          reviewId: randomUUID(),
        };
        await owner.query(
          "UPDATE content.cards SET client_updated_at = $1, last_operation_id = 'zzz' WHERE card_id = $2",
          [firstReviewAt, card.cardId],
        );
        assert.equal((await post("submit", input)).status, 409);
        await owner.query(
          "UPDATE content.cards SET client_updated_at = '2026-01-01T00:00:00Z' WHERE card_id = $1",
          [card.cardId],
        );
        await owner.query(
          "INSERT INTO content.review_events (review_event_id, workspace_id, card_id, replica_id, client_event_id, rating, reviewed_at_client) VALUES ($1, $2, $3, $4, $5, 0, $6)",
          [
            randomUUID(),
            workspaceId,
            card.cardId,
            replicaId,
            `agent-review:${input.reviewId}`,
            firstReviewAt,
          ],
        );
        const collision = await post("submit", input);
        assert.equal(collision.status, 409);
        assert.equal(
          ((await collision.json()) as { code: string }).code,
          "REVIEW_EVENT_CONFLICT",
        );
        assert.equal((await getCard(userId, workspaceId, card.cardId)).reps, 0);
      },
    );

    await t.test(
      "MCP keeps question and answer separate, exposes strict schemas, and replays HTTP receipts",
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
          const tool = tools.find((entry) => entry.name === "submit_review")!;
          assert.deepEqual(tool.annotations, {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
            idempotentHint: true,
          });
          assert.deepEqual(tool.inputSchema.required, [
            "cardId",
            "reviewId",
            "rating",
            "reviewedAtClient",
          ]);
          assert.equal(tool.inputSchema.additionalProperties, false);
          assert.deepEqual(
            (tool.inputSchema.properties!.rating as { enum: string[] }).enum,
            ratingNames,
          );
          const question = await client.callTool({
            name: "next_review_card",
            arguments: { workspaceId },
          });
          assert.equal(question.isError, undefined);
          assert.match(JSON.stringify(question), /Question only/);
          assert.doesNotMatch(JSON.stringify(question), /Secret answer/);
          const answer = await client.callTool({
            name: "reveal_answer",
            arguments: { workspaceId, cardId: retryCard.cardId },
          });
          assert.match(JSON.stringify(answer), /Secret answer/);
          const replay = await client.callTool({
            name: "submit_review",
            arguments: retryInput,
          });
          assert.deepEqual(
            JSON.parse((replay.content as Array<{ text: string }>)[0].text)
              .data,
            original!,
          );
          for (const patch of [
            { rating: "perfectly remembered" },
            { workspaceId: "invalid" },
            { dueAt: firstReviewAt },
          ]) {
            assert.equal(
              (
                await client.callTool({
                  name: "submit_review",
                  arguments: { ...retryInput, ...patch },
                })
              ).isError,
              true,
            );
          }
          for (const sql of [
            `UPDATE cards SET fsrs_stability = 100 WHERE card_id = '${retryCard.cardId}'`,
            "INSERT INTO review_events (rating) VALUES (3)",
            "DELETE FROM agent_review_receipts",
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
            arguments: { ...retryInput, workspaceId: randomUUID() },
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
      "receipt failure rolls back schedule, review history, and progress",
      async () => {
        const card = await makeCard();
        const input: AgentReviewInput = {
          ...retryInput,
          cardId: card.cardId,
          reviewId: randomUUID(),
        };
        const trigger = await owner.connect();
        try {
          await trigger.query(
            "CREATE FUNCTION pg_temp.reject_agent_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$",
          );
          await trigger.query(
            "CREATE TRIGGER reject_agent_receipt BEFORE INSERT ON sync.agent_review_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_agent_receipt()",
          );
          await assert.rejects(
            submitAgentReview(actor, input),
            /test receipt failure/,
          );
          assert.equal(
            (await getCard(userId, workspaceId, card.cardId)).reps,
            0,
          );
          assert.equal(
            (
              await owner.query(
                "SELECT count(*) FROM content.review_events WHERE card_id = $1",
                [card.cardId],
              )
            ).rows[0].count,
            "0",
          );
        } finally {
          await trigger.query(
            "DROP TRIGGER IF EXISTS reject_agent_receipt ON sync.agent_review_receipts",
          );
          trigger.release();
        }
        assert.equal((await submit(input)).reps, 1);
      },
    );

    await t.test(
      "empty queue, future cards, and tombstones never leak an answer or reserve a card",
      async () => {
        await owner.query(
          "UPDATE content.cards SET deleted_at = now() WHERE workspace_id = $1",
          [workspaceId],
        );
        assert.deepEqual(await nextReviewCard(actor), {
          workspaceId,
          card: null,
        });
        assert.equal(
          (await post("reveal", { workspaceId, cardId: retryCard.cardId }))
            .status,
          404,
        );
        assert.deepEqual(await submit(retryInput), original!);
        assert.equal(
          (await post("submit", { ...retryInput, reviewId: randomUUID() }))
            .status,
          404,
        );
        const card = await makeCard();
        assert.deepEqual(await nextReviewCard(actor), {
          workspaceId,
          card: { cardId: card.cardId, frontText: card.frontText },
        });
        assert.deepEqual(await nextReviewCard(actor), {
          workspaceId,
          card: { cardId: card.cardId, frontText: card.frontText },
        });
        const reviewed = await submit({
          ...retryInput,
          cardId: card.cardId,
          reviewId: randomUUID(),
          rating: "Easy",
          reviewedAtClient: new Date().toISOString(),
        });
        assert.ok(new Date(reviewed.dueAt).getTime() > Date.now());
        assert.deepEqual(await nextReviewCard(actor), {
          workspaceId,
          card: null,
        });
      },
    );

    await t.test(
      "authentication, membership revocation, and workspace boundaries apply to reads and retries",
      async () => {
        for (const action of ["next", "reveal", "submit"]) {
          const body =
            action === "next"
              ? {}
              : action === "reveal"
                ? { cardId: retryCard.cardId }
                : retryInput;
          assert.equal((await post(action, body, null)).status, 401);
          assert.equal(
            (await post(action, { ...body, workspaceId: randomUUID() })).status,
            404,
          );
        }
        const strangerId = randomUUID();
        await owner.query(
          "INSERT INTO org.user_settings (user_id) VALUES ($1)",
          [strangerId],
        );
        try {
          const stranger = await createAgentApiKeyForUser(
            strangerId,
            "Stranger",
          );
          assert.equal(
            (await post("submit", retryInput, stranger.apiKey)).status,
            404,
          );
          // Verify RLS separately from the HTTP membership preflight.
          assert.deepEqual(
            await nextReviewCard({ ...actor, userId: strangerId }),
            { workspaceId, card: null },
          );
        } finally {
          await owner.query(
            "DELETE FROM org.workspaces WHERE workspace_id IN (SELECT workspace_id FROM org.workspace_memberships WHERE user_id = $1)",
            [strangerId],
          );
          await owner.query(
            "DELETE FROM org.user_settings WHERE user_id = $1",
            [strangerId],
          );
        }
        await owner.query(
          "DELETE FROM org.workspace_memberships WHERE user_id = $1 AND workspace_id = $2",
          [userId, workspaceId],
        );
        assert.equal((await post("submit", retryInput)).status, 404);
        await owner.query(
          "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [workspaceId, userId],
        );
        await owner.query(
          "UPDATE auth.agent_api_keys SET revoked_at = now() WHERE connection_id = $1",
          [connection.connectionId],
        );
        assert.equal((await post("submit", retryInput)).status, 401);
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
