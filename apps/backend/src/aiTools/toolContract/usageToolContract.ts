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
  "Returns the account's current plan tier, the limits resolved for it, and how much AI it has consumed in the current monthly window. Call it to answer what plan the user is on or how much AI they have left, before a long AI-heavy job, and after a chat message was refused with AI_LIMIT_REACHED. It is account-scoped, takes no arguments, reads no cards, and changes nothing. A null entitlement.limits.aiMonthlyMessages means no AI cap is enforced for this account, never a limit of zero.";

/**
 * Written for a reader that has only this payload in front of it. The two things it has to get right
 * are that a `null` allowance means uncapped rather than exhausted, and that the window is our UTC
 * month rather than the caller's own month, because both invite a confident wrong answer.
 */
export const USAGE_LIMITS_RESULT_INSTRUCTIONS =
  "entitlement.tier is the stable tier id, entitlement.tierDisplayName is what to show the user, and entitlement.tierRank is what to compare when a feature requires a tier; never map tier ids to ranks yourself. entitlement.limits.aiMonthlyMessages is the monthly AI allowance in chat messages, and usage.usedMessages is how many this month has used against it: one message is one turn of the in-app AI chat, however many model or tool calls it made. Dictation, card image generation and chat suggestions do not use messages. usage.ownKeyMessages counts messages answered on the user's own AI provider key, which never count against the allowance. When aiMonthlyMessages and usage.remainingMessages are both null, no AI cap is enforced for this account at all: say the allowance is uncapped and do not present any number as a limit. Otherwise usage.remainingMessages is how many chat messages are left before the next one is refused with AI_LIMIT_REACHED. usage.usedWeightedTokens is this month's consumption on the platform key in weighted tokens, where one input token counts once and one output token counts usage.weightedOutputTokenMultiplier times; nothing is limited in tokens, so entitlement.limits.aiMonthlyWeightedTokens and usage.remainingWeightedTokens are always null and do not mean the account is uncapped. usage.monthStartsAt and usage.monthEndsAt bound the window, which is a calendar month in UTC for everybody and is unrelated to the user's own timezone, so the allowance resets at monthEndsAt. accountKind explains the allowance the tier alone does not: a limit is resolved per tier and account kind.";
