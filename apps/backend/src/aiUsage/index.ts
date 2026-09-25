/**
 * Metering for every AI surface: one appended fact per provider call, and one monthly allowance of chat
 * messages derived by counting those facts.
 *
 * The chat turn follows check-then-append: the enforcement point asks for the caller's allowance before
 * the provider is called, and the fact is appended after the provider answered. The two halves are
 * separate because they fail differently - a refusal is the caller's answer, while a fact that cannot be
 * stored must never become one. Every other surface only appends.
 *
 * `./status` neither checks nor appends: it reports the allowance and the month's facts together for a
 * caller that asks what it is on and what it has spent.
 */
export {
  aiLimitReachedCode,
  aiWeightedOutputTokenMultiplier,
  assertAiUsageAllowanceNotReached,
  countersCarryWeightedAiUsage,
  getAiUsageMonthWindow,
  guestAiLimitReachedCode,
  loadAiUsageMessagesForMonth,
  loadAiUsageWeightedTokensForMonth,
  reportDeferredAiUsageAllowanceResolutionFailure,
  reportHeavyAiUsageWeightedTokens,
  resolveAiUsageAllowance,
  resolveAiUsageAllowanceForEnforcement,
  resolveAiUsageTierForFacts,
} from "./cap";
export type { AiUsageAllowance, AiUsageMonthlyMessages, AiUsageMonthWindow } from "./cap";
export {
  toOpenAIImageUsageCounters,
  toOpenAIResponsesUsageCounters,
  toOpenAITranscriptionUsageCounters,
} from "./openaiUsage";
export type {
  OpenAIImageUsage,
  OpenAIResponsesUsage,
  OpenAITranscriptionUsage,
} from "./openaiUsage";
export { appendAiUsageEvent } from "./record";
export type {
  AiUsageCallAttribution,
  AiUsageCounters,
  AiUsageEvent,
  AiUsageProvider,
  AiUsageSurface,
} from "./record";
export { loadAiUsageStatus } from "./status";
export type { AiMonthlyUsage, AiUsageStatus } from "./status";
