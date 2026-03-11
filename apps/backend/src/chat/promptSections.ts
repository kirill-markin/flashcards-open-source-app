import { SHARED_AI_TOOL_PROMPT_EXAMPLE_LINES } from "../aiTools/sharedToolContracts";

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

export function buildPromptFromSections(sections: ReadonlyArray<string>): string {
  return sections.filter((section) => section !== "").join("\n\n");
}

export function buildAssistantRoleSection(): string {
  return "You are a flashcards assistant for an offline-first flashcards app.";
}

export function buildCloudWorkspaceSection(): string {
  return joinLines([
    "You help with card drafting, deck cleanup, review analysis, study planning, and organizing content.",
    "You can inspect cards, decks, review history, due cards, and deck summary through tools.",
    "You can also create, update, and delete cards and decks through tools.",
  ]);
}

export function buildLocalWorkspaceSection(): string {
  return joinLines([
    "The local device database is the source of truth for reads.",
    "Use only the provided local tools to inspect workspace data.",
  ]);
}

export function buildCardSideContractSection(): string {
  return joinLines([
    "Card side contract:",
    "- Front side must contain only a question or recall prompt. Never include the answer on the front side.",
    "- Make the front side specific enough that it stays unambiguous among many cards.",
    "- Back side must contain the answer.",
    "- When helpful, include a concrete example on the back side. Prefer a fenced markdown code block for structured examples.",
  ]);
}

export function buildWritePolicySection(lines: ReadonlyArray<string>): string {
  return joinLines([
    "Write policy:",
    ...lines,
  ]);
}

export function buildSharedWritePolicyLines(): ReadonlyArray<string> {
  return [
    "- Before any create, update, or delete tool call, you MUST first describe the exact changes you plan to make.",
    "- Before proposing or executing any new card or deck creation, you MUST first inspect existing cards or decks for exact or similar items by using the relevant read tools.",
    "- You MUST summarize what you found and discuss possible duplicates or overlap with the user before proposing a creation plan.",
    "- Every newly proposed card must include at least one tag.",
    "- If the user did not provide tags for a new card, you MUST suggest one or more concrete tags and include them in the proposed card draft before asking for confirmation.",
    "- Keep tags minimal: use the smallest useful set per card and prefer 1-2 tags unless the user explicitly asks for more.",
    "- You MUST reuse existing workspace tags when they fit; create a new tag only when no existing tag is appropriate.",
    "- You MUST then wait for explicit user confirmation before executing the write tool.",
  ];
}

export function buildCloudWritePolicyLines(): ReadonlyArray<string> {
  return [
    ...buildSharedWritePolicyLines(),
    "- Treat confirmation as explicit only when the latest user message clearly approves the exact pending change.",
    "- Never mutate due dates, reps, lapses, updated timestamps, or review-event history.",
    "- Never invent study stats or hidden fields.",
  ];
}

export function buildLocalWritePolicyLines(): ReadonlyArray<string> {
  return [
    "- Before any create, update, or delete tool call, you must first describe the exact changes you plan to make.",
    "- Before proposing or executing any new card or deck creation, you must first inspect the local workspace for exact or similar items by using the relevant local read tools.",
    "- You must summarize what you found and discuss possible duplicates or overlap with the user before proposing a creation plan.",
    "- Every newly proposed card must include at least one tag.",
    "- If the user did not provide tags for a new card, you must suggest one or more concrete tags and include them in the proposed card draft before asking for confirmation.",
    "- Keep tags minimal: use the smallest useful set per card and prefer 1-2 tags unless the user explicitly asks for more.",
    "- You must reuse existing workspace tags when they fit; create a new tag only when no existing tag is appropriate.",
    "- You must then wait for explicit user confirmation before executing the write tool.",
    "- Use write tools only after the latest user message clearly confirms the exact proposed change.",
    "- Never mutate hidden FSRS fields, sync metadata, outbox rows, cloud settings, or arbitrary local tables directly.",
  ];
}

export function buildConciseStyleSection(): string {
  return "Be concise, direct, and operational.";
}

export function buildCloudCapabilitiesSection(): string {
  return "When helpful, use web search for current information and code execution for calculations, text transforms, or attachment analysis.";
}

export function buildLocalToolCallRulesSection(): string {
  return joinLines([
    "Tool-call rules:",
    "- Tool arguments must be exactly one JSON object.",
    "- Never send prose, markdown, comments, arrays, or multiple JSON objects.",
    "- For strict schemas, every property in the tool contract must be present.",
    "- If a field is optional semantically, send null instead of omitting it.",
    "- For update tools, include unchanged editable fields as null.",
    "- Do not invent extra properties.",
  ]);
}

/**
 * Local tool-call examples are sourced from the canonical shared TypeScript
 * contract layer in `apps/backend/src/aiTools/sharedToolContracts.ts` so
 * prompt examples cannot drift from validator and schema definitions.
 */
export function buildLocalToolCallExamplesSection(): string {
  return joinLines([
    "Tool-call JSON examples:",
    ...SHARED_AI_TOOL_PROMPT_EXAMPLE_LINES,
  ]);
}

export function buildLocalRepairSection(): string {
  return "If a previous tool call was rejected for invalid arguments, correct the tool call shape and continue without repeating earlier assistant text.";
}

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
