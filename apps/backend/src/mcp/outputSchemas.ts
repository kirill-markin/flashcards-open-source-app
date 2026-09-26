import { z } from "zod";
import {
  GUIDE_TOPICS,
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_NAME,
} from "../aiTools/toolContract/sqlToolContract";
import { USAGE_LIMITS_TOOL_NAME } from "../aiTools/toolContract/usageToolContract";
import {
  GET_GUIDE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  NEXT_REVIEW_CARD_TOOL_NAME,
  REVEAL_ANSWER_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
} from "../aiTools/toolRegistry/specs";

const count = z.number().int().nonnegative();
// SELECT projections and RETURNING choose column names at runtime; nested JSON is valid SQL data.
const sqlRows = z.array(z.record(z.string(), z.json()));
const sqlReadStatement = z.object({
  statementType: z.enum(["show_tables", "describe", "select"]),
  resource: z.enum(["workspace", "cards", "decks", "review_events"]).nullable(),
  rows: sqlRows,
  rowCount: count,
  totalRowCount: count,
  rowsTruncated: z.boolean(),
  limit: count.nullable(),
  offset: count.nullable(),
  hasMore: z.boolean(),
});
const sqlMutationStatement = z.object({
  statementType: z.enum(["insert", "update", "delete"]),
  resource: z.enum(["cards", "decks"]),
  rows: sqlRows,
  affectedCount: count,
});
const submittedSql = {
  sql: z.string(),
  normalizedSql: z.string(),
  workspaceId: z.string(),
};
const sqlOmissions = {
  rowsOmitted: z.boolean(),
  sqlOmitted: z.boolean(),
};
const sqlBatch = z.object({
  ...submittedSql,
  ...sqlOmissions,
  statementType: z.literal("batch"),
  resource: z.null(),
  statementCount: count,
});

const docs = z.object({
  discoveryUrl: z.string(),
  source: z.object({
    repositoryUrl: z.string(),
    agentRoutesUrl: z.string(),
    authRoutesUrl: z.string(),
  }),
});

function envelope<Data extends z.ZodType>(data: Data): z.ZodObject<{
  ok: z.ZodLiteral<true>;
  data: Data;
  instructions: z.ZodString;
  docs: typeof docs;
}> {
  return z.object({
    ok: z.literal(true),
    data,
    instructions: z.string(),
    docs,
  });
}

const outputSchemas: Readonly<Record<string, z.ZodObject | undefined>> = {
  [SQL_QUERY_TOOL_NAME]: envelope(z.union([
    sqlReadStatement.extend(submittedSql),
    sqlBatch.extend({
      statements: z.array(sqlReadStatement),
      affectedCountTotal: z.null(),
    }),
  ])),
  [SQL_EXECUTE_TOOL_NAME]: envelope(z.union([
    sqlMutationStatement.extend({ ...submittedSql, ...sqlOmissions }),
    sqlBatch.extend({
      statements: z.array(sqlMutationStatement),
      affectedCountTotal: count,
    }),
  ])),
  [LIST_WORKSPACES_TOOL_NAME]: envelope(z.object({
    workspaces: z.array(z.object({
      workspaceId: z.string(),
      name: z.string(),
      createdAt: z.string(),
      isSelected: z.boolean(),
      cardCount: count,
      lastActivityAt: z.string().nullable(),
    })),
  })),
  [GET_GUIDE_TOOL_NAME]: envelope(z.object({
    topic: z.enum(GUIDE_TOPICS),
    guide: z.string(),
  })),
  [NEXT_REVIEW_CARD_TOOL_NAME]: envelope(z.object({
    workspaceId: z.string(),
    card: z.object({ cardId: z.string(), frontText: z.string() }).nullable(),
  })),
  [REVEAL_ANSWER_TOOL_NAME]: envelope(z.object({
    workspaceId: z.string(),
    cardId: z.string(),
    backText: z.string(),
  })),
  [SUBMIT_REVIEW_TOOL_NAME]: envelope(z.object({
    workspaceId: z.string(),
    cardId: z.string(),
    reviewId: z.string(),
    reviewEventId: z.string(),
    rating: z.enum(["Again", "Hard", "Good", "Easy"]),
    reviewedAt: z.string(),
    dueAt: z.string(),
    intervalSeconds: z.number().nonnegative(),
    scheduledDays: z.number().nonnegative(),
    state: z.enum(["new", "learning", "review", "relearning"]),
    reps: count,
    lapses: count,
  })),
  [USAGE_LIMITS_TOOL_NAME]: envelope(z.object({
    accountKind: z.enum(["account", "guest"]),
    entitlement: z.object({
      tier: z.enum(["free", "premium", "lifetime"]),
      tierRank: count,
      tierDisplayName: z.string(),
      status: z.enum(["none", "active", "in_grace"]),
      until: z.string().nullable(),
      isTrial: z.boolean(),
      willRenew: z.boolean(),
      limits: z.object({
        aiMonthlyMessages: count.nullable(),
        aiMonthlyWeightedTokens: z.null(),
      }),
    }),
    usage: z.object({
      monthStartsAt: z.string(),
      monthEndsAt: z.string(),
      usedMessages: count,
      remainingMessages: count.nullable(),
      ownKeyMessages: count,
      usedWeightedTokens: z.number().nonnegative(),
      remainingWeightedTokens: z.null(),
      weightedOutputTokenMultiplier: z.number().nonnegative(),
    }),
  })),
};

export function requireMcpToolOutputSchema(toolName: string): z.ZodObject {
  const schema = outputSchemas[toolName];
  if (schema === undefined) {
    throw new Error(`Tool ${toolName} is listed for MCP but has no output schema.`);
  }
  return schema;
}
