/**
 * Metering for every AI surface: one appended fact per provider call, and one monthly allowance derived
 * by summing those facts.
 *
 * The shape every surface follows is check-then-append: the enforcement point asks for the caller's
 * allowance before the provider is called, and the fact is appended after the provider answered. The
 * two halves are separate because they fail differently - a refusal is the caller's answer, while a fact
 * that cannot be stored must never become one.
 */
export {
  aiLimitReachedCode,
  aiWeightedOutputTokenMultiplier,
  assertAiUsageAllowanceNotReached,
  countersCarryWeightedAiUsage,
  getAiUsageMonthWindow,
  loadAiUsageWeightedTokensForMonth,
  requireAiUsageAllowance,
  resolveAiUsageAllowance,
  resolveAiUsageAllowanceForEnforcement,
  resolveAiUsageTierForFacts,
} from "./cap";
export type { AiUsageAllowance, AiUsageMonthWindow } from "./cap";
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
