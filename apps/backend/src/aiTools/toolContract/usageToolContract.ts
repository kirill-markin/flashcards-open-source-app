/**
 * The one contract behind "what am I on, and how much have I used": the tool name, what the model is
 * told the call is for, and what it is told about the answer. It is a contract module rather than part
 * of a spec because the Agent REST route serves the same payload and the same result instructions
 * without reading the registry (docs/agent-tool-surfaces.md, "REST is not a registry surface").
 *
 * The payload itself and the reads behind it live in `apps/backend/src/aiUsage/status.ts`.
 */

export const USAGE_LIMITS_TOOL_NAME = "get_usage_limits";

export const USAGE_LIMITS_TOOL_DESCRIPTION =
  "Returns the account's current plan tier, the limits resolved for it, and how much AI it has already consumed in the current monthly window. Call it to answer what plan the user is on or how much AI they have left, before starting a long AI-heavy job, and after an AI call was refused with AI_LIMIT_REACHED. It is account-scoped rather than workspace-scoped, takes no arguments, reads no cards, and changes nothing. A null monthly allowance means no AI cap is enforced for this account, never a limit of zero.";

/**
 * Written for a reader that has only this payload in front of it. The two things it has to get right
 * are that a `null` allowance means uncapped rather than exhausted, and that the window is our UTC
 * month rather than the caller's own month, because both invite a confident wrong answer.
 */
export const USAGE_LIMITS_RESULT_INSTRUCTIONS =
  "entitlement.tier is the stable tier id, entitlement.tierDisplayName is what to show the user, and entitlement.tierRank is what to compare when a feature requires a tier; never map tier ids to ranks yourself. entitlement.limits.aiMonthlyWeightedTokens is the monthly AI allowance and usage.usedWeightedTokens is what this month has spent against it, both in weighted tokens: one input token counts once and one output token counts usage.weightedOutputTokenMultiplier times. When aiMonthlyWeightedTokens and usage.remainingWeightedTokens are both null, no AI cap is enforced for this account at all: say the allowance is uncapped and do not present any number as a limit. Otherwise usage.remainingWeightedTokens is what is left before the next AI call is refused with AI_LIMIT_REACHED. usage.monthStartsAt and usage.monthEndsAt bound the window, which is a calendar month in UTC for everybody and is unrelated to the user's own timezone, so the allowance resets at monthEndsAt. accountKind explains the allowance the tier alone does not: a limit is resolved per tier and account kind, and a guest is capped for being a guest whatever tier it holds.";
