import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { unsafeTransaction } from "../database/unsafe";
import { HttpError } from "../shared/errors";
import {
  withPostgresIntegrationFixture,
  type PostgresIntegrationFixture,
} from "../testSupport/postgresIntegration";
import {
  aiLimitReachedCode,
  assertAiUsageAllowanceNotReached,
  getAiUsageMonthWindow,
  loadAiUsageMessagesForMonth,
  loadAiUsageWeightedTokensForMonth,
  resolveAiUsageAllowance,
} from "./cap";
import {
  anonymizeAiUsageForDeletedPersonInExecutor,
  transferAiUsageToUpgradedAccountInExecutor,
} from "./identity";
import { appendAiUsageEvent, type AiUsageCounters, type AiUsageEvent } from "./record";

// The allowance is a count over rows the surfaces append, so what is worth pinning is the part no pure
// test can reach: that the append matches the shipped ai.usage_events grants and columns, that every
// counter lands in the column it names rather than in the one beside it, that a message is one chat
// turn on the platform key however many calls it made, that the weighted sum weights the counters the
// way it is denominated, and that the UTC month boundary really excludes the month before. The append
// also swallows its own failures on purpose, so every test here reads the stored rows back rather than
// trusting that the call returned.
//
// This file must stay listed in apps/backend/scripts/postgresIntegrations/boundaries.mjs, because an
// unlisted integration file is never executed by any workflow.

type UsageEventRow = Readonly<{
  surface: string;
  provider: string;
  model_id: string;
  request_id: string | null;
  tier_at_call: string;
  workspace_id: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  cache_write_tokens: string | null;
  reasoning_tokens: string | null;
  audio_seconds: string | null;
  image_count: number | null;
  image_size: string | null;
  image_quality: string | null;
  user_supplied_key: boolean;
}>;

type UsageEventCountRow = Readonly<{ stored: number }>;

const storedUsageEventsQuery = [
  "SELECT surface, provider, model_id, request_id, tier_at_call, workspace_id::text AS workspace_id,",
  "input_tokens::text AS input_tokens, output_tokens::text AS output_tokens,",
  "cache_read_tokens::text AS cache_read_tokens, cache_write_tokens::text AS cache_write_tokens,",
  "reasoning_tokens::text AS reasoning_tokens, audio_seconds::text AS audio_seconds,",
  "image_count, image_size, image_quality, user_supplied_key",
  "FROM ai.usage_events",
  "WHERE user_id = $1",
  "ORDER BY occurred_at",
].join(" ");

function createCounters(overrides: Partial<AiUsageCounters>): AiUsageCounters {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    audioSeconds: null,
    ...overrides,
  };
}

function createChatUsageEvent(
  userId: string,
  workspaceId: string,
  occurredAt: Date,
  requestId: string,
  counters: AiUsageCounters,
): AiUsageEvent {
  return {
    userId,
    workspaceId,
    occurredAt,
    surface: "chat",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    requestId,
    tierAtCall: "free",
    counters,
    imageCount: null,
    imageSize: null,
    imageQuality: null,
    userSuppliedKey: false,
  };
}

async function countStoredUsageEvents(fixture: PostgresIntegrationFixture): Promise<number> {
  const result = await fixture.ownerPool.query<UsageEventCountRow>(
    "SELECT count(*)::int AS stored FROM ai.usage_events WHERE user_id = $1",
    [fixture.userId],
  );
  return result.rows[0]?.stored ?? 0;
}

type UsageEventIdentityRow = Readonly<{
  user_id: string;
  workspace_id: string | null;
  request_id: string | null;
}>;

async function loadUsageEventIdentities(
  fixture: PostgresIntegrationFixture,
  userId: string,
): Promise<ReadonlyArray<UsageEventIdentityRow>> {
  const result = await fixture.ownerPool.query<UsageEventIdentityRow>(
    [
      "SELECT user_id, workspace_id::text AS workspace_id, request_id",
      "FROM ai.usage_events WHERE user_id = $1",
    ].join(" "),
    [userId],
  );
  return result.rows;
}

async function deleteStoredRows(fixture: PostgresIntegrationFixture): Promise<void> {
  // Through the owner pool, because backend_app holds no DELETE on an append-only table.
  await fixture.ownerPool.query("DELETE FROM ai.usage_events WHERE user_id = $1", [fixture.userId]);
  await fixture.ownerPool.query(
    "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1",
    [fixture.userId],
  );
}

test("the monthly allowance counts this UTC month's chat messages and refuses the next turn once it is reached", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
      const now = new Date("2026-09-15T12:00:00.000Z");
      const monthWindow = getAiUsageMonthWindow(now);
      const allowance = await resolveAiUsageAllowance(fixture.userId, "guest", now);
      const monthlyMessages = allowance.monthlyMessages;
      if (monthlyMessages === null) {
        throw new Error("A free guest must resolve a capped monthly AI allowance for this test to mean anything.");
      }

      await assertAiUsageAllowanceNotReached(allowance, fixture.userId, now);

      // A whole allowance of turns at the last instant of the previous UTC month. The window is
      // half-open, so none of them counts against September.
      for (let index = 0; index < monthlyMessages; index += 1) {
        await appendAiUsageEvent(createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          new Date("2026-08-31T23:59:59.999Z"),
          `ai-usage-integration-august-${String(index)}`,
          createCounters({ inputTokens: 1 }),
        ));
      }
      await assertAiUsageAllowanceNotReached(allowance, fixture.userId, now);

      // One turn short of the allowance, the first at the first instant of this UTC month. Each turn
      // makes two model calls and is still one message.
      for (let index = 0; index < monthlyMessages - 1; index += 1) {
        const requestId = `ai-usage-integration-september-${String(index)}`;
        const occurredAt = index === 0 ? monthWindow.startsAt : now;
        await appendAiUsageEvent(createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          occurredAt,
          requestId,
          createCounters({ inputTokens: 1 }),
        ));
        await appendAiUsageEvent(createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          occurredAt,
          requestId,
          createCounters({ outputTokens: 1 }),
        ));
      }

      // Other surfaces and the person's own key are metered, and none of them is a platform-key message.
      await appendAiUsageEvent({
        ...createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          now,
          "ai-usage-integration-dictation",
          createCounters({ inputTokens: 1 }),
        ),
        surface: "dictation",
      });
      await appendAiUsageEvent({
        ...createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          now,
          "ai-usage-integration-suggestions",
          createCounters({ inputTokens: 1 }),
        ),
        surface: "composer_suggestion",
      });
      await appendAiUsageEvent({
        ...createChatUsageEvent(
          fixture.userId,
          fixture.workspaceId,
          now,
          "ai-usage-integration-own-key",
          createCounters({ inputTokens: 1_000_000 }),
        ),
        userSuppliedKey: true,
      });
      assert.equal(await countStoredUsageEvents(fixture), monthlyMessages + 2 * (monthlyMessages - 1) + 3);
      assert.deepEqual(await loadAiUsageMessagesForMonth(fixture.userId, monthWindow), {
        platformKeyMessages: monthlyMessages - 1,
        ownKeyMessages: 1,
      });
      // The weighted sum reads the same platform-key rows of the same month: 1 + 6 x 1 per turn, plus
      // one input token each for dictation and suggestions, and nothing from the own-key row.
      assert.equal(
        await loadAiUsageWeightedTokensForMonth(fixture.userId, monthWindow),
        (monthlyMessages - 1) * 7 + 2,
      );
      await assertAiUsageAllowanceNotReached(allowance, fixture.userId, now);

      // The turn that reaches the allowance completes; the next one is refused.
      await appendAiUsageEvent(createChatUsageEvent(
        fixture.userId,
        fixture.workspaceId,
        now,
        "ai-usage-integration-september-last",
        createCounters({ inputTokens: 1 }),
      ));
      await assert.rejects(
        () => assertAiUsageAllowanceNotReached(allowance, fixture.userId, now),
        (error: unknown): boolean => {
          assert.equal(error instanceof HttpError, true);
          if (error instanceof HttpError === false) {
            return false;
          }

          assert.equal(error.statusCode, 429);
          assert.equal(error.code, aiLimitReachedCode);
          return true;
        },
      );

      // The window moves with the clock rather than with the rows: the next UTC month starts clear.
      await assertAiUsageAllowanceNotReached(
        allowance,
        fixture.userId,
        new Date("2026-10-01T00:00:00.000Z"),
      );
    } finally {
      await deleteStoredRows(fixture);
    }
  });
});

test("an uncapped allowance is never refused, and a call the provider reported nothing for is still stored", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
      const now = new Date("2026-09-15T12:00:00.000Z");
      const allowance = await resolveAiUsageAllowance(fixture.userId, "account", now);
      assert.equal(allowance.monthlyMessages, null);

      await appendAiUsageEvent({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        occurredAt: now,
        surface: "card_image",
        provider: "openai",
        modelId: "gpt-image-2",
        requestId: null,
        tierAtCall: allowance.tier,
        counters: null,
        imageCount: 1,
        imageSize: "1024x1024",
        imageQuality: "low",
        // True here because false is the column default, so only true proves the writer sets it.
        userSuppliedKey: true,
      });

      const stored = await fixture.ownerPool.query<UsageEventRow>(
        storedUsageEventsQuery,
        [fixture.userId],
      );
      assert.equal(stored.rows.length, 1);
      assert.deepEqual(stored.rows[0], {
        surface: "card_image",
        provider: "openai",
        model_id: "gpt-image-2",
        request_id: null,
        tier_at_call: "free",
        workspace_id: fixture.workspaceId,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        reasoning_tokens: null,
        audio_seconds: null,
        image_count: 1,
        image_size: "1024x1024",
        image_quality: "low",
        user_supplied_key: true,
      });

      // A card image is never a message, so it cannot refuse an uncapped caller.
      await assertAiUsageAllowanceNotReached(allowance, fixture.userId, now);
    } finally {
      await deleteStoredRows(fixture);
    }
  });
});

// The counters reach the database as positional parameters in one nineteen-column insert, and a swap
// between two adjacent nullable counters is invisible to a test that leaves them null or asserts only
// the weighted sum. Every counter therefore carries a distinct value here and is read back on its own
// column: the four that the weighted sum does not weigh are read only by a cost report and never by
// metering, some of them as price multipliers and some as breakdowns a cost report must not price -
// reasoning tokens sit inside output_tokens, so pricing both double-counts them
// (db/migrations/0152_ai_usage_facts.sql) - which makes a swap between them silently wrong reporting
// rather than a failing request.
test("every reported counter lands in its own column, and only the token counters are weighted", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    try {
      const now = new Date("2026-09-15T12:00:00.000Z");
      const allowance = await resolveAiUsageAllowance(fixture.userId, "account", now);

      await appendAiUsageEvent({
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
        occurredAt: now,
        surface: "dictation",
        provider: "openai",
        modelId: "gpt-4o-transcribe",
        requestId: "ai-usage-integration-columns",
        tierAtCall: allowance.tier,
        counters: {
          inputTokens: 11,
          outputTokens: 22,
          cacheReadTokens: 33,
          cacheWriteTokens: 44,
          reasoningTokens: 55,
          // Fractional on purpose: audio_seconds is the one NUMERIC counter, so a swap with any of the
          // BIGINT ones beside it fails the insert outright instead of storing a plausible number.
          audioSeconds: 66.5,
        },
        imageCount: null,
        imageSize: null,
        imageQuality: null,
        userSuppliedKey: false,
      });

      const stored = await fixture.ownerPool.query<UsageEventRow>(
        storedUsageEventsQuery,
        [fixture.userId],
      );
      assert.equal(stored.rows.length, 1);
      assert.deepEqual(stored.rows[0], {
        surface: "dictation",
        provider: "openai",
        model_id: "gpt-4o-transcribe",
        request_id: "ai-usage-integration-columns",
        tier_at_call: "free",
        workspace_id: fixture.workspaceId,
        input_tokens: "11",
        output_tokens: "22",
        cache_read_tokens: "33",
        cache_write_tokens: "44",
        reasoning_tokens: "55",
        audio_seconds: "66.5",
        image_count: null,
        image_size: null,
        image_quality: null,
        user_supplied_key: false,
      });

      // Only the two token counters take part: 11 + 6 x 22. The cache, reasoning and audio counters are
      // stored facts that the weighted sum gives no weight, which is what makes a duration-only
      // dictation row weigh nothing by decision rather than by accident.
      assert.equal(
        await loadAiUsageWeightedTokensForMonth(fixture.userId, getAiUsageMonthWindow(now)),
        143,
      );
    } finally {
      await deleteStoredRows(fixture);
    }
  });
});

// Both statements here are the callers db/migrations/0154_ai_usage_identity_rewrites.sql grants
// UPDATE (user_id, workspace_id, request_id) for, and a grant is exactly what no pure test can reach:
// the table is
// append-only for everything else, and 0152 created one row-level-security policy per granted command,
// so a missing UPDATE policy would make either rewrite match no row and report success. The transfer
// also has to keep the monthly allowance intact across an upgrade, which is a count over these rows for
// one person and therefore only observable end to end.
test("the identity rewrites carry the allowance across an upgrade and anonymise it on deletion", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const guestUserId = `${fixture.userId}-guest`;
    const guestWorkspaceId = fixture.outOfScopeWorkspaceId;
    const anonymizedUserId = randomUUID();
    try {
      const occurredAt = new Date("2026-09-15T12:00:00.000Z");
      const monthWindow = getAiUsageMonthWindow(occurredAt);
      await appendAiUsageEvent(createChatUsageEvent(
        guestUserId,
        guestWorkspaceId,
        occurredAt,
        "ai-usage-integration-request",
        createCounters({ inputTokens: 10, outputTokens: 1 }),
      ));
      // The append swallows its own failures, so the row is read back rather than assumed.
      assert.equal(await loadAiUsageWeightedTokensForMonth(guestUserId, monthWindow), 16);

      await unsafeTransaction(async (executor) => {
        await transferAiUsageToUpgradedAccountInExecutor(
          executor,
          guestUserId,
          guestWorkspaceId,
          fixture.userId,
          fixture.workspaceId,
        );
      });

      // Signing up must not reset the monthly allowance, which is the whole reason the rows move.
      assert.deepEqual(await loadAiUsageMessagesForMonth(fixture.userId, monthWindow), {
        platformKeyMessages: 1,
        ownKeyMessages: 0,
      });
      assert.deepEqual(await loadAiUsageMessagesForMonth(guestUserId, monthWindow), {
        platformKeyMessages: 0,
        ownKeyMessages: 0,
      });
      assert.equal(await loadAiUsageWeightedTokensForMonth(fixture.userId, monthWindow), 16);
      assert.equal(await loadAiUsageWeightedTokensForMonth(guestUserId, monthWindow), 0);
      // The request id survives a transfer: the person is still there, and it is what correlates the
      // row with the logs of the call that produced it.
      assert.deepEqual(await loadUsageEventIdentities(fixture, fixture.userId), [{
        user_id: fixture.userId,
        workspace_id: fixture.workspaceId,
        request_id: "ai-usage-integration-request",
      }]);

      await unsafeTransaction(async (executor) => {
        await anonymizeAiUsageForDeletedPersonInExecutor(
          executor,
          [fixture.userId, guestUserId],
          anonymizedUserId,
        );
      });

      // The row survives, because what a call cost is a fact about the product. What goes is the person,
      // and with them every column that could name them again: the workspace id, which outlives the
      // workspace and would rejoin this row to their content, and the request id, whose whole purpose is
      // correlating the row with logs and error reports that still carry the real user id.
      assert.deepEqual(await loadUsageEventIdentities(fixture, anonymizedUserId), [{
        user_id: anonymizedUserId,
        workspace_id: null,
        request_id: null,
      }]);
      assert.deepEqual(await loadUsageEventIdentities(fixture, fixture.userId), []);
    } finally {
      await deleteStoredRows(fixture);
      await fixture.ownerPool.query(
        "DELETE FROM ai.usage_events WHERE user_id = ANY($1::text[])",
        [[guestUserId, anonymizedUserId]],
      );
    }
  });
});
