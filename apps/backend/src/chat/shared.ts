/**
 * Shared system-prompt builders for the backend-owned chat stack.
 * These helpers keep the new server-owned chat contract aligned across routes, runtime, and replay.
 */

import {
  CARD_AUTHORING_CONTRACT,
  CARD_AUTHORING_TOOL_CALL_EXAMPLE,
  CARD_BACK_SIDE_RULE_LINES,
  CARD_DUPLICATE_CHECK_RULE_LINES,
  CARD_STYLE_ALIGNMENT_RULE_LINES,
  CARD_TAGGING_RULE_LINES,
  SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  SQL_MUTATION_TAG_FILTER_DESCRIPTION,
  SQL_RETURNING_DESCRIPTION,
  SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
  SQL_TOOL_PROMPT_EXAMPLE_LINES,
} from "../aiTools/toolContract/sqlToolContract";

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

function buildPromptFromSections(sections: ReadonlyArray<string>): string {
  return sections.filter((section) => section !== "").join("\n\n");
}

function buildAssistantRoleSection(): string {
  return "You are a flashcards assistant for an offline-first flashcards app.";
}

function buildWorkspaceSection(): string {
  return joinLines([
    "You work over the synced workspace state managed by the backend.",
    "Use the shared sql tool to inspect workspace data.",
    "Decks are saved tag filters: a deck row exposes deck_id, name, and tags among other columns, and has no description column.",
    "Cards have no deck_id and no deck membership, so a card belongs to a deck only by matching that deck's tags.",
    "You help with card drafting, deck cleanup, review analysis, study planning, and organizing content.",
  ]);
}

function buildCardSideContractSection(): string {
  return joinLines([
    "Card side contract:",
    "- Front side must contain only a question or recall prompt. Never include the answer on the front side.",
    "- Keep the front short by default: usually one word, a term, or a brief phrase, not a full sentence question.",
    "- Front brevity does not limit the back side, which may still be long.",
    "- Write a longer front only when the user asks for it, or when similar existing cards in the same deck, tag, or topic already use long fronts.",
    ...CARD_BACK_SIDE_RULE_LINES,
  ]);
}

function buildCardAuthoringSection(): string {
  return joinLines([
    CARD_AUTHORING_CONTRACT,
    `Example: ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
  ]);
}

function buildCardStyleAlignmentSection(): string {
  return joinLines([
    "Card style alignment:",
    ...CARD_STYLE_ALIGNMENT_RULE_LINES,
  ]);
}

function buildPlainTextChatFormattingSection(): string {
  return joinLines([
    "Chat response formatting:",
    "- Respond as plain text for a compact chat surface.",
    "- Keep replies concise and easy to scan on mobile and web.",
    "- Do not rely on markdown headings, tables, blockquotes, or fenced code blocks in user-facing chat replies.",
    "- These plain-text reply rules apply to chat messages, not to card fields such as backText.",
  ]);
}

function buildWritePolicySection(): string {
  return joinLines([
    "Write policy:",
    "- Before any create, update, or delete tool call, you must first describe the exact changes you plan to make.",
    ...CARD_DUPLICATE_CHECK_RULE_LINES,
    "- A clear user request for a specific low-risk change counts as permission to execute it.",
    "- If the user already gave explicit permission earlier in this chat, do not ask again for ordinary low-risk writes.",
    "- Ask for confirmation again only when the action is risky or unclear, for example broad deletes, broad updates, destructive resets, revokes, overwrites, or ambiguous instructions.",
    "- Creating one card or making one small focused edit usually does not need a second confirmation.",
    ...CARD_TAGGING_RULE_LINES,
    "- Do not mutate hidden FSRS fields, sync metadata, or arbitrary non-product tables directly.",
  ]);
}

function buildToolCallRulesSection(): string {
  return joinLines([
    "Tool-call rules:",
    "- Tool arguments must be exactly one JSON object.",
    "- Use the shared sql tool for workspace reads, writes, and schema discovery.",
    "- Send SHOW TABLES, DESCRIBE, and SHOW COLUMNS as their own tool call, never in the same sql string as statements that depend on the result.",
    "- Put the whole query in the sql string field and do not invent extra tool arguments.",
    "- SQL pagination uses LIMIT and OFFSET inside the SQL string.",
    "- SELECT returns at most 100 rows per statement.",
    "- INSERT, UPDATE, and DELETE may affect at most 100 rows per statement.",
    "- Before calling any tool, send one short user-facing sentence explaining what you are about to check.",
  ]);
}

/**
 * The dialect grammar the in-app `sql` tool description has no room for: OpenAI
 * caps a function description at 1024 characters, these instructions are not
 * capped, and the in-app chat has no `get_guide` tool to fetch a guide with.
 * Every constant here is one `SQL_DIALECT_GUIDE` composes too, directly or
 * through `SQL_MUTATION_WHERE_SUPPORTED_FORMS_DESCRIPTION`, so the in-app chat
 * and MCP stay on one dialect. The filterable/sortable line is a literal on
 * purpose: the shared grammar constants state the rule only for `metadata`, and
 * widening them would rewrite the guide bodies for every surface.
 */
function buildSqlDialectSection(): string {
  return joinLines([
    "SQL dialect:",
    SQL_SELECT_SUPPORTED_FORMS_DESCRIPTION,
    "DESCRIBE and SHOW COLUMNS report filterable and sortable per column: a column with filterable false is rejected in a WHERE clause, and a column with sortable false is rejected in ORDER BY.",
    "UPDATE and DELETE WHERE clauses support the same forms as SELECT WHERE clauses.",
    SQL_MUTATION_TAG_FILTER_DESCRIPTION,
    "Array columns (e.g. tags) take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
    SQL_RETURNING_DESCRIPTION,
    SQL_BULK_WRITE_SPLIT_DESCRIPTION,
  ]);
}

/** The full example list; the tool description carries only one read and one write example. */
function buildSqlExampleSection(): string {
  return joinLines([
    "Examples (tool-call JSON):",
    ...SQL_TOOL_PROMPT_EXAMPLE_LINES,
  ]);
}

function buildGeneratedImagePolicySection(): string {
  return joinLines([
    "Generated-image policy:",
    "- Use only for an explicit image request or delegated visual augmentation; inspect the target card with sql first, then announce the selected card and side.",
    "- Prefer the back unless specified otherwise; create teaching-relevant imagery with focused, private-data-free, moderation-compliant prompts, and never put an answer or answer-revealing image on the front.",
    "- Treat queued as accepted for durable attachment processing, not as proof that presentation is already visible; for already_queued, failure, ambiguity, or cancellation, never claim a new image or expose fcasset markdown, base64, or storage internals.",
  ]);
}

function buildRepairSection(): string {
  return joinLines([
    "If a previous tool call was rejected for invalid arguments, correct the tool call shape and continue without repeating earlier assistant text.",
    "If a tool output returns structured error JSON with ok=false, use error.message to correct the next tool call and continue.",
  ]);
}

function buildDatetimeSection(timezone: string): string {
  const now = new Date();
  const utc = now.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const local = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  return `Current datetime - UTC: ${utc} | User local (${timezone}): ${local}`;
}

/**
 * Builds the canonical system instructions for backend-owned chat turns.
 */
export function buildSystemInstructions(
  timezone: string,
  generatedImageEligible: boolean,
): string {
  return buildPromptFromSections([
    buildAssistantRoleSection(),
    buildWorkspaceSection(),
    buildCardSideContractSection(),
    buildCardAuthoringSection(),
    buildCardStyleAlignmentSection(),
    buildPlainTextChatFormattingSection(),
    buildWritePolicySection(),
    buildToolCallRulesSection(),
    buildSqlDialectSection(),
    buildSqlExampleSection(),
    generatedImageEligible ? buildGeneratedImagePolicySection() : "",
    buildRepairSection(),
    "Be concise, direct, and operational.",
    buildDatetimeSection(timezone),
  ]);
}
