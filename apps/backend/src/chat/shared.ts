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
  SQL_MUTATION_TAG_FILTER_DESCRIPTION,
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
    "Use sql_query to read workspace data and sql_execute to change it.",
    "The user can have several workspaces: list_workspaces lists them, and sql_query and sql_execute take an optional workspaceId from that list; omit it to use the workspace the user has open.",
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
    "- Use sql_query for workspace reads and schema discovery, and sql_execute for writes.",
    "- Send SHOW TABLES, DESCRIBE, and SHOW COLUMNS as their own tool call, never in the same sql string as statements that depend on the result.",
    "- Never mix read and write statements in one sql string.",
    "- Put the whole query in the sql string field and do not invent extra tool arguments.",
    "- SQL pagination uses LIMIT and OFFSET inside the SQL string.",
    "- SELECT returns at most 100 rows per statement.",
    "- INSERT, UPDATE, and DELETE may affect at most 100 rows per statement.",
    "- Before calling any tool, send one short user-facing sentence explaining what you are about to check.",
  ]);
}

/**
 * Where the rest of the dialect lives, modelled on `SERVER_INSTRUCTIONS` in
 * `apps/backend/src/mcp/server.ts`. The grammar, the text-column rules,
 * RETURNING, the batch arithmetic, and the full example list are served by
 * `get_guide` topic `sql_dialect` on demand, instead of being re-sent on every
 * one of a turn's model calls.
 *
 * What stays inline is what a first call gets wrong with nothing to read
 * afterwards, because the chat pays a wrong first guess out of its own model-call
 * budget: tags are spelled like nothing in standard SQL and every new card
 * carries one, and the tag forms that miss return zero rows rather than an
 * error, so a model that reaches for one of them reports "no cards found" and
 * never learns that it needed the guide. The forms that fail loudly are left to
 * the guide, which the model fetches after reading the dialect error.
 *
 * `get_guide` serves every surface, so the guides bullet is the single place
 * that says which of its topics this chat can use: it rules out
 * `card_authoring` alone, whose text the card sections above already state in
 * full.
 */
function buildSqlRoutingSection(): string {
  return joinLines([
    "SQL dialect:",
    "- This is not full PostgreSQL. Call get_guide with topic sql_dialect before any statement whose form you are unsure of, and again after a dialect error, instead of guessing.",
    "- Guides are written for every surface: topic card_authoring only repeats the card rules above, so use topics sql_dialect, bulk_authoring, and review_flow, and never call a tool you were not given.",
    "- Match rows by tag with tags OVERLAP ('english', 'slang'), compared exactly and case-sensitively, so pass tag values as they are stored.",
    `- ${SQL_MUTATION_TAG_FILTER_DESCRIPTION}`,
    "- Array columns such as tags take a parenthesized list: ('tag1', 'tag2'), or () for empty.",
    "- Prefer OVERLAP over the tag forms that fail silently: tags = ('english', 'slang') is exact set equality, so a card carrying any extra tag does not match, and tags IN (...), LOWER(tags) IN (...), and LOWER(tags) NOT IN (...) are accepted but match no rows.",
    "- LIKE, NOT LIKE, ILIKE, and the LOWER(column) LIKE and LOWER(column) = forms apply to text columns only and are rejected on an array column such as tags.",
    "- Before a large write job, call get_guide with topic bulk_authoring and split the work as it says.",
  ]);
}

/**
 * The review loop itself is served by `get_guide` topic `review_flow` and by the review tools' own
 * descriptions, so this states only what neither can: where this surface's two caller-owned values
 * come from. The timezone is printed verbatim by `buildDatetimeSection`, and the reviewId is the
 * dedup key, so a model reusing one is refused rather than recording a second review.
 */
function buildReviewLoopSection(): string {
  return joinLines([
    "Review loop:",
    "- To review the user one question at a time, call next_review_card, then reveal_answer for that cardId, then submit_review; call get_guide with topic review_flow for the grading and rating rules.",
    "- Pass the User local timezone printed in the datetime line below as submit_review's reviewedTimeZone, spelled exactly as it appears there.",
    "- Generate one fresh random UUID as submit_review's reviewId per learner review, and reuse it only to retry that same card's submission.",
  ]);
}

function buildGeneratedImagePolicySection(): string {
  return joinLines([
    "Generated-image policy:",
    "- Use only for an explicit image request or delegated visual augmentation; inspect the target card with sql_query first, then announce the selected card and side.",
    "- add_generated_image_to_card works only on cards in the workspace the user has open, so never give it a card that was read with a different workspaceId.",
    "- Prefer the back unless specified otherwise; create teaching-relevant imagery with focused, private-data-free, moderation-compliant prompts, and never put an answer or answer-revealing image on the front.",
    "- Treat queued as accepted for durable attachment processing, not as proof that presentation is already visible; for already_queued, failure, ambiguity, or cancellation, never claim a new image or expose fcasset markdown, base64, or storage internals.",
  ]);
}

/**
 * The second sentence names the tools whose failure envelopes the shared remediation module fills
 * (`createAgentRemediationInstructions` in
 * `apps/backend/src/aiTools/toolContract/remediationInstructions.ts`), because those are the only
 * ones carrying an `instructions` field and an `error.message`. The generated-image tool fails with
 * `{ ok: false, code, retryable }` and is steered by its own policy section above, so widening this
 * to every tool would point the model at fields that envelope does not have.
 */
function buildRepairSection(): string {
  return joinLines([
    "If a previous tool call was rejected for invalid arguments, correct the tool call shape and continue without repeating earlier assistant text.",
    "If a sql_query, sql_execute, list_workspaces, get_guide, next_review_card, reveal_answer, or submit_review tool output returns structured error JSON with ok=false, follow its instructions field and use error.message to correct the next tool call and continue.",
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
    buildSqlRoutingSection(),
    buildReviewLoopSection(),
    generatedImageEligible ? buildGeneratedImagePolicySection() : "",
    buildRepairSection(),
    "Be concise, direct, and operational.",
    buildDatetimeSection(timezone),
  ]);
}
