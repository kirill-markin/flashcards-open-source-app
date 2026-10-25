import {
  previewSqlStatement,
  type AgentSqlPayloadWithWorkspace,
  type AgentSqlReadPayload,
} from "../../../aiTools/agentSql/shared";
import { cutHeadAtCodePoint } from "../../../shared/codePointCuts";

/** `error.message` ends with the remediation the model reads next, so there is no separate field. */
export type ToolErrorPayload = Readonly<{
  error: Readonly<{
    name: string;
    message: string;
  }>;
  sql?: string | null;
  code?: string;
  details?: unknown;
}>;

/**
 * Each tool result is appended to the loop continuation and re-sent on every later model
 * call in the turn, so one large SQL result set inflates every subsequent request and can
 * trigger context_length_exceeded. ~24K chars leaves roughly 6K tokens of headroom per result.
 */
export const MAX_TOOL_OUTPUT_CHARS = 24_000 as const;

/**
 * The marker overhead only seeds the first preview length. The slice is JSON-escaped into a
 * string field, and `omittedChars` gains decimal digits as the preview shrinks, so no single
 * arithmetic pass lands on the budget.
 *
 * `keptFacts`, when given, stays under `fieldKey` beside the preview, so facts the head cut
 * could lose still reach the model at their usual path.
 */
function capEnvelopeFieldToBudget(
  envelope: Readonly<Record<string, unknown>>,
  fieldKey: string,
  keptFacts: Readonly<Record<string, unknown>> | null,
): string {
  const serializedField = JSON.stringify(envelope[fieldKey] ?? null);
  const { [fieldKey]: _omitted, ...rest } = envelope;
  const previewKey = `${fieldKey}Preview`;
  const buildCapped = (previewLength: number): string => {
    const preview = cutHeadAtCodePoint(serializedField, previewLength);
    return JSON.stringify({
      ...rest,
      ...(keptFacts === null ? {} : { [fieldKey]: keptFacts }),
      [previewKey]: preview,
      truncated: true,
      omittedChars: serializedField.length - preview.length,
    });
  };

  let previewLength = Math.max(0, MAX_TOOL_OUTPUT_CHARS - buildCapped(0).length);
  let capped = buildCapped(previewLength);
  while (capped.length > MAX_TOOL_OUTPUT_CHARS && previewLength > 0) {
    previewLength = Math.max(0, previewLength - (capped.length - MAX_TOOL_OUTPUT_CHARS));
    capped = buildCapped(previewLength);
  }

  return capped;
}

/**
 * Only `envelope[fieldKey]` and the SQL echo shrink. Every other field is carried through untouched,
 * so the returned string fits `MAX_TOOL_OUTPUT_CHARS` unless what it carries regardless of the
 * preview - those remaining fields as serialized, the shortened echo, the empty preview key, the
 * `truncated`/`omittedChars` markers, and the JSON scaffolding around them - exceeds the budget
 * together. A failure carrying a long database error message is the reachable case of that: the
 * message need not fill the budget on its own to push the rest of the envelope past it, and the
 * result comes back over budget with the preview already driven to nothing.
 */
function capSerializedEnvelope(
  envelope: Readonly<Record<string, unknown>>,
  fieldKey: string,
  keptFacts: Readonly<Record<string, unknown>> | null,
): string {
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const capped = capEnvelopeFieldToBudget(envelope, fieldKey, keptFacts);
  if (capped.length <= MAX_TOOL_OUTPUT_CHARS) {
    return capped;
  }

  const sqlEcho = envelope.sql;
  if (typeof sqlEcho !== "string") {
    return capped;
  }

  const shortenedSqlEcho = previewSqlStatement(sqlEcho);
  if (shortenedSqlEcho === sqlEcho) {
    return capped;
  }

  return capEnvelopeFieldToBudget({ ...envelope, sql: shortenedSqlEcho }, fieldKey, keptFacts);
}

type SqlToolSuccessPayload = Readonly<{
  sql: string;
  data: AgentSqlPayloadWithWorkspace;
}>;

/**
 * The serialized data starts with the echoed SQL, so a head cut of a large write drops these;
 * they stay readable as `data.*` beside `dataPreview`.
 */
function pickSqlResultFacts(data: AgentSqlPayloadWithWorkspace): Readonly<Record<string, unknown>> {
  return {
    workspaceId: data.workspaceId,
    ...(data.reviewUrl === undefined ? {} : { reviewUrl: data.reviewUrl }),
    ...("affectedCount" in data ? { affectedCount: data.affectedCount } : {}),
    ...(data.statementType === "batch" ? { affectedCountTotal: data.affectedCountTotal } : {}),
  };
}

function buildSqlToolEnvelope(
  toolName: string,
  payload: SqlToolSuccessPayload,
): Readonly<Record<string, unknown>> {
  return {
    ok: true,
    tool: toolName,
    ...payload,
  };
}

/**
 * The prefix is found by binary search over the row count rather than by predicting where to
 * cut: serialized size grows with the prefix length, so the search finds the exact largest
 * fitting prefix, and a handful of measurement passes on a payload that is already an outlier
 * is cheaper than being clever about it. The search stops one row short of the whole page,
 * because a payload that kept every row is not a truncated one and must not be marked as such.
 *
 * Returns null when not even one row fits, which is the caller's signal to fall back to the
 * preview slice: a partial answer carrying no row shows the model neither the data nor its
 * shape, and the chat has no rejection path here, so something bounded still has to go back.
 */
function capReadEnvelopeByRows(
  toolName: string,
  payload: SqlToolSuccessPayload,
  data: AgentSqlReadPayload & Pick<AgentSqlPayloadWithWorkspace, "workspaceId" | "reviewUrl">,
): string | null {
  const serializeRowPrefix = (rowCount: number): string =>
    JSON.stringify(buildSqlToolEnvelope(toolName, {
      ...payload,
      data: {
        ...data,
        rows: data.rows.slice(0, rowCount),
        rowCount,
        rowsTruncated: true,
        hasMore: true,
      },
    }));

  let lowestRowCount = 1;
  let highestRowCount = data.rows.length - 1;
  let largestFitting: string | null = null;

  while (lowestRowCount <= highestRowCount) {
    const candidateRowCount = Math.floor((lowestRowCount + highestRowCount) / 2);
    const candidate = serializeRowPrefix(candidateRowCount);
    if (candidate.length <= MAX_TOOL_OUTPUT_CHARS) {
      largestFitting = candidate;
      lowestRowCount = candidateRowCount + 1;
    } else {
      highestRowCount = candidateRowCount - 1;
    }
  }

  return largestFitting;
}

export function createSqlToolSuccessResult(toolName: string, payload: SqlToolSuccessPayload): string {
  const envelope = buildSqlToolEnvelope(toolName, payload);
  const serialized = JSON.stringify(envelope);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) {
    return serialized;
  }

  const data = payload.data;
  if (data.statementType === "select" && data.rows.length > 0) {
    const rowCapped = capReadEnvelopeByRows(toolName, payload, data);
    if (rowCapped !== null) {
      return rowCapped;
    }
  }

  return capSerializedEnvelope(envelope, "data", pickSqlResultFacts(data));
}

/** The same envelope uncut, for code that reads it rather than the model: the chat sandbox's SQL bridge. */
export function createWholeSqlToolSuccessResult(toolName: string, payload: SqlToolSuccessPayload): string {
  return JSON.stringify(buildSqlToolEnvelope(toolName, payload));
}

export function createToolErrorResult(toolName: string, payload: ToolErrorPayload): string {
  return capSerializedEnvelope(
    {
      ok: false,
      tool: toolName,
      ...payload,
    },
    "details",
    null,
  );
}

/** The success envelope of every tool that echoes no statement. */
export function createToolSuccessResult<Data>(
  toolName: string,
  data: Data,
): string {
  return capSerializedEnvelope(
    {
      ok: true,
      tool: toolName,
      data,
    },
    "data",
    null,
  );
}
