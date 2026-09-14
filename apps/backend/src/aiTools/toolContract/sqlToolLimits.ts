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
 * Maximum serialized size (in UTF-16 code units, i.e. JS string length) of the
 * agent envelope a single agent SQL tool/endpoint result is emitted in.
 *
 * Reads reject a payload above this budget; writes are already committed when
 * the payload is measured, so they shrink instead of failing: they shorten the
 * echoed statement text when that makes the emitted payload smaller, then drop
 * the returned rows if the payload is still over budget.
 *
 * The MCP directory caps a tool result at roughly 25k tokens. The row-count
 * limits above (100 rows, 50 statements) do not bound serialized size: 100
 * cards with long markdown `back_text` can still overflow that token budget.
 *
 * Sizing: using a conservative ~4 chars/token heuristic, 25k tokens is ~100k
 * chars. We target well under that to leave headroom for tokenization that runs
 * hotter than 4 chars/token on dense JSON/markdown. 48,000 chars (~12k tokens
 * at 4 chars/token) is a safe round number that stays comfortably below the
 * directory limit.
 */
export const MAX_SQL_RESULT_CHARS = 48_000;

/**
 * Maximum combined size, in `o200k_base` tokens, of everything a `tools/list`
 * response carries.
 *
 * ChatGPT rejects an MCP server whose tool definitions together exceed 5,000
 * tokens. We hold 4,500 and keep the remaining 500 tokens as headroom for the
 * per-tool envelope a host wraps around our metadata before it counts.
 */
export const MAX_ALL_TOOLS_METADATA_TOKENS = 4_500;

/**
 * Maximum length of a single tool description.
 *
 * OpenAI's published limit for a function description is 1,024 characters.
 * Claude Code separately truncates a tool description at 2,048, so the tighter
 * number governs.
 */
export const MAX_TOOL_DESCRIPTION_CHARS = 1_024;

/**
 * Maximum length of the server instructions block: Claude Code truncates
 * server instructions at 2 KB.
 */
export const MAX_SERVER_INSTRUCTIONS_CHARS = 2_048;

/**
 * Maximum length of one input-schema field description.
 *
 * This is our own sub-budget rather than a vendor limit: field descriptions are
 * counted inside the same `tools/list` total as the tool descriptions above, so
 * a field that grows unchecked spends a budget every tool shares.
 */
export const MAX_TOOL_FIELD_DESCRIPTION_CHARS = 512;

/**
 * Maximum length of a tool name in the form the model finally sees.
 *
 * Anthropic and OpenAI both cap a tool name at 64 characters, and clients
 * prefix an MCP tool with the server name (`mcp__<server>__<tool>`), so the
 * prefix is spent out of the same 64.
 */
export const MAX_PREFIXED_TOOL_NAME_CHARS = 64;
