/**
 * Legacy chat backend prompt builders for old `/chat/turn` clients.
 * The backend-first `/chat` stack builds and replays server-owned prompts differently.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { SQL_TOOL_PROMPT_EXAMPLE_LINES } from "../../aiTools/sqlToolContract";

/**
 * This legacy chat backend helper joins prompt lines for old `/chat/turn` prompt assembly.
 * The backend-first `/chat` stack composes prompts through a different server-owned runtime flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

/**
 * This legacy chat backend helper assembles prompt sections for old `/chat/turn` clients.
 * The backend-first `/chat` stack builds prompts differently around persisted sessions and runs.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildPromptFromSections(sections: ReadonlyArray<string>): string {
  return sections.filter((section) => section !== "").join("\n\n");
}

/**
 * This legacy chat backend helper defines the assistant role prompt for old `/chat/turn` clients.
 * The backend-first `/chat` stack owns its system prompt through a different server-side contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildAssistantRoleSection(): string {
  return "You are a flashcards assistant for an offline-first flashcards app.";
}

/**
 * This legacy chat backend helper defines the cloud workspace prompt section for old `/chat/turn` clients.
 * The backend-first `/chat` stack no longer relies on this legacy cloud/local prompt split.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildCloudWorkspaceSection(): string {
  return joinLines([
    "You help with card drafting, deck cleanup, review analysis, study planning, and organizing content.",
    "You can inspect workspace, cards, decks, and review events through SQL.",
    "You can also create, update, and delete cards and decks through SQL.",
  ]);
}

/**
 * This legacy chat backend helper defines the local workspace prompt section for old `/chat/turn` clients.
 * The backend-first `/chat` stack represents workspace access through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildLocalWorkspaceSection(): string {
  return joinLines([
    "You work over the synced workspace state managed by the backend.",
    "Use the shared sql tool to inspect workspace data.",
  ]);
}

/**
 * This legacy chat backend helper defines the card-side prompt rules for old `/chat/turn` clients.
 * The backend-first `/chat` stack enforces the same product contract through a different server-owned chat flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildCardSideContractSection(): string {
  return joinLines([
    "Card side contract:",
    "- Front side must contain only a question or recall prompt. Never include the answer on the front side.",
    "- Do not put the key insight or distinguishing detail on the front side; the front should ask for it, and the back should reveal it.",
    "- Make the front side specific enough that it stays unambiguous among many cards.",
    "- Back side must start with the direct answer.",
    "- After the answer, include one or more concrete examples by default when creating a card.",
    "- Skip examples only when the user explicitly asks you not to include them.",
    "- For code cards, prefer concrete code snippets in fenced markdown code blocks.",
    "- For business, conceptual, or practical cards, prefer concrete real-world usage examples.",
    "- Keep chat replies plain text, but card content may freely use markdown.",
  ]);
}

/**
 * This legacy chat backend helper defines card-effort prompt rules for old `/chat/turn` clients.
 * The backend-first `/chat` stack keeps this guidance in a different server-owned prompt pipeline.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildCardEffortSection(): string {
  return joinLines([
    "Card effort rules:",
    "- Default to fast unless the user clearly wants a slower card.",
    "- Fast is the normal default and should be used for almost all cards.",
    "- Medium is for cards where the person needs to sit and write or work through a solution for around five minutes.",
    "- Long is for unusually long cards with half-day activities and should be very rare.",
  ]);
}

/**
 * This legacy chat backend helper defines plain-text reply rules for old `/chat/turn` clients.
 * The backend-first `/chat` stack formats replies through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildPlainTextChatFormattingSection(): string {
  return joinLines([
    "Chat response formatting:",
    "- Respond to the user as plain text for a chat surface that does not render markdown.",
    "- Keep replies compact and comfortable to read in a small chat window on mobile devices and in the browser.",
    "- Do not rely on markdown styling or markdown-only presentation.",
    "- Simple lists and numbering are allowed when they remain readable as raw plain text.",
    "- If you need a more complex structure, use short labels, indentation, and blank lines between blocks.",
    "- Do not use markdown headings, fenced code blocks, tables, blockquotes, or similar markdown formatting in user-facing chat replies.",
    "- If you need to mention literal card field content, present it as raw field content while keeping the surrounding chat reply in plain text.",
  ]);
}

/**
 * This legacy chat backend helper wraps write-policy prompt lines for old `/chat/turn` clients.
 * The backend-first `/chat` stack assembles tool and write policies through a different server-owned prompt flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildWritePolicySection(lines: ReadonlyArray<string>): string {
  return joinLines([
    "Write policy:",
    ...lines,
  ]);
}

/**
 * This legacy chat backend helper returns shared write-policy lines for old `/chat/turn` clients.
 * The backend-first `/chat` stack keeps write constraints in a different server-owned prompt contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildSharedWritePolicyLines(): ReadonlyArray<string> {
  return [
    "- Before any create, update, or delete tool call, you MUST first describe the exact changes you plan to make.",
    "- Before proposing or executing any new card or deck creation, you MUST first inspect existing cards or decks for exact or similar items through SQL.",
    "- You MUST summarize what you found and discuss possible duplicates or overlap with the user before proposing a creation plan.",
    "- If the requested create, update, or delete work would affect more than 100 records, you MUST split it into multiple batches of at most 100 records and execute them across separate SQL statements or separate tool calls.",
    "- Every newly proposed card must include at least one tag.",
    "- If the user did not provide tags for a new card, you MUST suggest one or more concrete tags and include them in the proposed card draft before asking for confirmation.",
    "- Keep tags minimal: use the smallest useful set per card and prefer 1-2 tags unless the user explicitly asks for more.",
    "- By default, you MUST reuse existing workspace tags whenever that is possible and logically fits the card.",
    "- You MUST create a new tag only when no existing workspace tag is appropriate, and you MUST ask the user to approve that new tag before proposing or executing it.",
    "- You MUST then wait for explicit user confirmation before executing the write tool.",
  ];
}

/**
 * This legacy chat backend helper returns cloud-specific write-policy lines for old `/chat/turn` clients.
 * The backend-first `/chat` stack does not use this legacy cloud-vs-local split.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildCloudWritePolicyLines(): ReadonlyArray<string> {
  return [
    ...buildSharedWritePolicyLines(),
    "- Treat confirmation as explicit only when the latest user message clearly approves the exact pending change.",
    "- Never mutate due dates, reps, lapses, updated timestamps, or review-event history.",
    "- Never invent study stats or hidden fields.",
  ];
}

/**
 * This legacy chat backend helper returns local write-policy lines for old `/chat/turn` clients.
 * The backend-first `/chat` stack keeps equivalent guidance in a different server-owned prompt pipeline.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildLocalWritePolicyLines(): ReadonlyArray<string> {
  return [
    "- Before any create, update, or delete tool call, you must first describe the exact changes you plan to make.",
    "- Before proposing or executing any new card or deck creation, you must first inspect the workspace for exact or similar items through the shared sql tool.",
    "- You must summarize what you found and discuss possible duplicates or overlap with the user before proposing a creation plan.",
    "- If the requested create, update, or delete work would affect more than 100 records, you must split it into multiple batches of at most 100 records and execute them across separate SQL statements or separate tool calls.",
    "- Every newly proposed card must include at least one tag.",
    "- If the user did not provide tags for a new card, you must suggest one or more concrete tags and include them in the proposed card draft before asking for confirmation.",
    "- Keep tags minimal: use the smallest useful set per card and prefer 1-2 tags unless the user explicitly asks for more.",
    "- By default, you must reuse existing workspace tags whenever that is possible and logically fits the card.",
    "- You must create a new tag only when no existing workspace tag is appropriate, and you must ask the user to approve that new tag before proposing or executing it.",
    "- You must then wait for explicit user confirmation before executing the write tool.",
    "- Use write tools only after the latest user message clearly confirms the exact proposed change.",
    "- Never mutate hidden FSRS fields, sync metadata, or arbitrary non-product tables directly.",
  ];
}

/**
 * This legacy chat backend helper defines concise-style guidance for old `/chat/turn` clients.
 * The backend-first `/chat` stack keeps reply-style guidance in a different server-owned prompt contract.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildConciseStyleSection(): string {
  return "Be concise, direct, and operational.";
}

/**
 * This legacy chat backend helper defines cloud-only capabilities for old `/chat/turn` clients.
 * The backend-first `/chat` stack no longer routes through this legacy cloud capability layer.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildCloudCapabilitiesSection(): string {
  return "When helpful, use web search for current information and code execution for calculations, text transforms, or attachment analysis.";
}

/**
 * This legacy chat backend helper defines tool-call rules for old `/chat/turn` clients.
 * The backend-first `/chat` stack enforces tool-call structure through a different server-owned runtime.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildLocalToolCallRulesSection(): string {
  return joinLines([
    "Tool-call rules:",
    "- Tool arguments must be exactly one JSON object.",
    "- Never send prose, markdown, comments, arrays, or multiple JSON objects.",
    "- For strict schemas, every required property in the tool contract must be present.",
    "- Use the shared sql tool for workspace reads, writes, and schema discovery.",
    "- Put the whole query in the sql string field and do not invent extra tool arguments.",
    "- SQL pagination uses LIMIT and OFFSET inside the SQL string.",
    "- SELECT returns at most 100 rows per statement.",
    "- INSERT, UPDATE, and DELETE may affect at most 100 rows per statement.",
    "- If you need to create, update, or delete more than 100 records, split the work into multiple batches of at most 100 records and execute them across separate SQL statements or separate tool calls.",
    "- Do not invent extra properties.",
    "- Before calling any tool, send one short user-facing sentence explaining what you are about to check.",
  ]);
}

/**
 * This legacy chat backend helper sources tool-call examples for old `/chat/turn` clients.
 * The backend-first `/chat` stack documents tool usage through a different server-owned runtime path.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildLocalToolCallExamplesSection(): string {
  return joinLines([
    "Tool-call JSON examples:",
    ...SQL_TOOL_PROMPT_EXAMPLE_LINES,
  ]);
}

/**
 * This legacy chat backend helper defines repair guidance for old `/chat/turn` clients.
 * The backend-first `/chat` stack drives tool-call repair through a different server-owned runtime loop.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildLocalRepairSection(): string {
  return joinLines([
    "If a previous tool call was rejected for invalid arguments, correct the tool call shape and continue without repeating earlier assistant text.",
    "If a tool output returns structured error JSON with ok=false, use error.message to correct the next tool call and continue.",
  ]);
}

/**
 * This legacy chat backend helper defines lightweight user context for old `/chat/turn` clients.
 * The backend-first `/chat` stack now keeps session and run context on the server differently.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildUserContextSection(totalCards: number): string {
  return joinLines([
    "User context:",
    `- The current workspace has ${totalCards} cards.`,
  ]);
}

/**
 * This legacy chat backend helper renders current timestamps into the old `/chat/turn` prompt.
 * The backend-first `/chat` stack injects time context through a different server-owned prompt flow.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function buildDatetimeSection(timezone: string): string {
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
