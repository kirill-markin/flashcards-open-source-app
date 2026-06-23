/**
 * Canonical SQL tool limits for the TypeScript runtimes.
 *
 * Keep these values aligned with:
 * - `apps/backend/src/aiTools/agentSql/shared.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/AIChatTypes.swift`
 */
export const MAX_SQL_RECORD_LIMIT = 100;
export const MAX_SQL_BATCH_STATEMENT_COUNT = 50;

/**
 * Maximum serialized size (in UTF-16 code units, i.e. JS string length) of a
 * single agent SQL tool/endpoint result payload.
 *
 * The MCP directory caps a tool result at roughly 25k tokens. The row-count
 * limits above (100 rows, 50 statements) do not bound serialized size: 100
 * cards with long markdown `back_text` can still overflow that token budget.
 *
 * Sizing: using a conservative ~4 chars/token heuristic, 25k tokens is ~100k
 * chars. We target well under that to leave headroom for the surrounding
 * envelope (`instructions`, `docs`, error metadata) and for tokenization that
 * runs hotter than 4 chars/token on dense JSON/markdown. 48,000 chars (~12k
 * tokens at 4 chars/token) is a safe round number that stays comfortably below
 * the directory limit.
 */
export const MAX_SQL_RESULT_CHARS = 48_000;
