import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../database";
import {
  CHAT_LOW_COST_MODEL_ID,
  CHAT_LOW_COST_MODEL_REASONING_EFFORT,
  CHAT_MODEL_ID,
  CHAT_MODEL_REASONING_EFFORT,
  type ChatRuntimeModelId,
  type ChatRuntimeReasoningEffort,
} from "./config";

export const CHAT_COST_POLICY_MODE_NORMAL = "normal" as const;
export const CHAT_COST_POLICY_MODE_LOW_COST = "low_cost" as const;
export const CHAT_COST_POLICY_CHAT_TURNS_7D_THRESHOLD = 20;
export const CHAT_COST_POLICY_GOOD_REVIEW_DAYS_7D_THRESHOLD = 2;
export const CHAT_COST_POLICY_MIN_REVIEWS_PER_GOOD_DAY = 3;
export const CHAT_COST_POLICY_WINDOW_DAYS = 7;

export type ChatCostPolicyMode =
  | typeof CHAT_COST_POLICY_MODE_NORMAL
  | typeof CHAT_COST_POLICY_MODE_LOW_COST;

export type ChatCostPolicySignals = Readonly<{
  chatTurnsLast7d: number;
  goodReviewDaysLast7d: number;
}>;

export type ChatCostPolicyDecision = Readonly<ChatCostPolicySignals & {
  mode: ChatCostPolicyMode;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
}>;

type ChatCostPolicySignalRow = QueryResultRow & Readonly<{
  chat_turns_last_7d: number | string;
  good_review_days_last_7d: number | string;
}>;

const SELECT_CHAT_COST_POLICY_SIGNALS_SQL = `
  WITH chat_activity AS (
    SELECT
      COUNT(chat_runs.run_id)::integer AS chat_turns_last_7d
    FROM ai.chat_sessions AS chat_sessions
    JOIN ai.chat_runs AS chat_runs
      ON chat_runs.session_id = chat_sessions.session_id
    WHERE chat_sessions.user_id = $1
      AND chat_sessions.workspace_id = $2
      AND chat_runs.created_at >= now() - ($4::integer * INTERVAL '1 day')
  ),
  daily_reviews AS (
    SELECT
      timezone($3, review_events.reviewed_at_server)::date AS review_day,
      COUNT(review_events.review_event_id)::integer AS review_events_count
    FROM sync.workspace_replicas AS replicas
    JOIN content.review_events AS review_events
      ON review_events.workspace_id = replicas.workspace_id
      AND review_events.replica_id = replicas.replica_id
      AND review_events.reviewed_at_server >= now() - ($4::integer * INTERVAL '1 day')
    WHERE replicas.workspace_id = $2
      AND replicas.user_id = $1
      AND replicas.actor_kind = 'client_installation'
    GROUP BY timezone($3, review_events.reviewed_at_server)::date
  ),
  review_activity AS (
    SELECT
      COUNT(*) FILTER (WHERE review_events_count >= $5)::integer AS good_review_days_last_7d
    FROM daily_reviews
  )
  SELECT
    chat_activity.chat_turns_last_7d,
    COALESCE(review_activity.good_review_days_last_7d, 0)::integer AS good_review_days_last_7d
  FROM chat_activity
  CROSS JOIN review_activity
`;

function parseIntegerSignal(value: number | string, fieldName: string): number {
  const parsedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid chat cost policy signal ${fieldName}: ${String(value)}`);
  }

  return parsedValue;
}

function mapSignalRow(row: ChatCostPolicySignalRow): ChatCostPolicySignals {
  return {
    chatTurnsLast7d: parseIntegerSignal(row.chat_turns_last_7d, "chat_turns_last_7d"),
    goodReviewDaysLast7d: parseIntegerSignal(row.good_review_days_last_7d, "good_review_days_last_7d"),
  };
}

function getDecisionRuntimeConfig(mode: ChatCostPolicyMode): Readonly<{
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
}> {
  if (mode === CHAT_COST_POLICY_MODE_LOW_COST) {
    return {
      modelId: CHAT_LOW_COST_MODEL_ID,
      reasoningEffort: CHAT_LOW_COST_MODEL_REASONING_EFFORT,
    };
  }

  return {
    modelId: CHAT_MODEL_ID,
    reasoningEffort: CHAT_MODEL_REASONING_EFFORT,
  };
}

/**
 * Routes heavy chat-only behavior to a cheaper model until the user shows real flashcard use.
 *
 * Product examples:
 * 20 chat turns + 0 good review days -> low_cost
 * 20 chat turns + 1 day with 3 reviews -> low_cost
 * 20 chat turns + 2 days with 3+ reviews each -> normal
 * 19 chat turns + 0 reviews -> normal
 */
export function decideChatCostPolicy(signals: ChatCostPolicySignals): ChatCostPolicyDecision {
  const mode = signals.chatTurnsLast7d >= CHAT_COST_POLICY_CHAT_TURNS_7D_THRESHOLD
    && signals.goodReviewDaysLast7d < CHAT_COST_POLICY_GOOD_REVIEW_DAYS_7D_THRESHOLD
    ? CHAT_COST_POLICY_MODE_LOW_COST
    : CHAT_COST_POLICY_MODE_NORMAL;
  const runtimeConfig = getDecisionRuntimeConfig(mode);

  return {
    ...signals,
    mode,
    modelId: runtimeConfig.modelId,
    reasoningEffort: runtimeConfig.reasoningEffort,
  };
}

export function getChatCostPolicyModeForModel(modelId: ChatRuntimeModelId): ChatCostPolicyMode {
  return modelId === CHAT_LOW_COST_MODEL_ID
    ? CHAT_COST_POLICY_MODE_LOW_COST
    : CHAT_COST_POLICY_MODE_NORMAL;
}

export async function selectChatCostPolicySignalsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  timezone: string,
): Promise<ChatCostPolicySignals> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  const result = await executor.query<ChatCostPolicySignalRow>(
    SELECT_CHAT_COST_POLICY_SIGNALS_SQL,
    [
      scope.userId,
      scope.workspaceId,
      timezone,
      CHAT_COST_POLICY_WINDOW_DAYS,
      CHAT_COST_POLICY_MIN_REVIEWS_PER_GOOD_DAY,
    ],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error("Chat cost policy signal query returned no rows");
  }

  return mapSignalRow(row);
}

export async function decideChatCostPolicyWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  timezone: string,
): Promise<ChatCostPolicyDecision> {
  const signals = await selectChatCostPolicySignalsWithExecutor(executor, scope, timezone);
  return decideChatCostPolicy(signals);
}
