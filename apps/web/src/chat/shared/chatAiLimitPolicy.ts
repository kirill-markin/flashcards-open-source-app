import type { DateTimeValue, TranslationKey, TranslationValues } from "../../i18n";
import { ApiError } from "../../api/transport/errors";
import { parseBrowserGuestAiTrialQuota } from "../../apiContracts/aiUsage";
import type { AiUsageAccountKind, AiUsageStatus, BrowserGuestAiRefusal, BrowserGuestAiTrialFeature, BrowserGuestCapabilities, ContentPart } from "../../types";

export const AI_LIMIT_REACHED_CODE = "AI_LIMIT_REACHED";
export const GUEST_AI_LIMIT_REACHED_CODE = "GUEST_AI_LIMIT_REACHED";

type AiLimitReachedMessageParams = Readonly<{
  accountKind: AiUsageAccountKind;
  monthEndsAt: string | null;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
}>;

export function isAiLimitReachedError(params: Readonly<{
  code: string | null;
}>): boolean {
  return params.code === AI_LIMIT_REACHED_CODE || params.code === GUEST_AI_LIMIT_REACHED_CODE;
}

/**
 * `monthEndsAt` is midnight UTC on the first day of the next month, so the renewal date is formatted
 * in UTC; a local time zone west of UTC would name the last day of the current month instead.
 */
function formatAiLimitReachedMessage(params: AiLimitReachedMessageParams): string {
  const { accountKind, monthEndsAt, t, formatDate } = params;
  if (accountKind === "guest") {
    return t("chatPanel.errors.aiLimitReachedGuest");
  }

  if (monthEndsAt === null) {
    return t("chatPanel.errors.aiLimitReachedAccountNoDate");
  }

  return t("chatPanel.errors.aiLimitReachedAccount", {
    date: formatDate(monthEndsAt, { month: "long", day: "numeric", timeZone: "UTC" }),
  });
}

/**
 * Held usage describes the current month only until its `monthEndsAt` passes; a tab left open across
 * a month boundary still holds last month's counts and renewal date until the next read.
 */
export function isHeldAiUsageCurrent(aiUsage: AiUsageStatus): boolean {
  return Date.parse(aiUsage.usage.monthEndsAt) > Date.now();
}

export function formatAiLimitReachedMessageForHeldUsage(params: Readonly<{
  aiUsage: AiUsageStatus | null;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;
}>): string {
  const { aiUsage, t, formatDate } = params;
  return formatAiLimitReachedMessage({
    accountKind: aiUsage?.accountKind ?? "account",
    monthEndsAt: aiUsage !== null && isHeldAiUsageCurrent(aiUsage) ? aiUsage.usage.monthEndsAt : null,
    t,
    formatDate,
  });
}

export function getBrowserGuestAiErrorRefusal(error: unknown, feature: BrowserGuestAiTrialFeature): BrowserGuestAiRefusal | null {
  if (!(error instanceof ApiError)) return null;
  if (error.browserGuestAiTrialQuota !== null) return error.browserGuestAiTrialQuota;
  return error.code === "GUEST_WEB_AI_SIGN_IN_REQUIRED"
    ? { feature, scope: "sign_in", resetsAt: null }
    : null;
}

export function getBrowserGuestAiAdmissionRefusal(
  usage: AiUsageStatus | null,
  capabilities: BrowserGuestCapabilities | null,
  feature: BrowserGuestAiTrialFeature,
): BrowserGuestAiRefusal | null {
  if (capabilities === null) return null;
  const trial = usage?.browserGuestAiTrial;
  if (capabilities.platformFundedAi === false || trial?.enabled !== true) {
    return { feature, scope: "sign_in", resetsAt: null };
  }
  if (trial[feature].lifetimeRemaining === 0) return { feature, scope: "guest", resetsAt: null };
  if (trial[feature].sharedAvailable === false && Date.parse(trial.sharedResetsAt) > Date.now()) {
    return { feature, scope: "shared", resetsAt: trial.sharedResetsAt };
  }
  return null;
}

export function readGuestImageRefusal(content: ReadonlyArray<ContentPart>): BrowserGuestAiRefusal | null {
  for (const part of content) {
    if (part.type !== "tool_call" || part.name !== "add_generated_image_to_card" || part.output === null) continue;
    let output: unknown;
    try {
      output = JSON.parse(part.output) as unknown;
    } catch {
      continue; // Streaming tool JSON may still be incomplete.
    }
    if (typeof output !== "object" || output === null || !("ok" in output) || output.ok !== false
      || !("code" in output) || output.code !== "BROWSER_GUEST_AI_TRIAL_QUOTA_REACHED") continue;
    return parseBrowserGuestAiTrialQuota("details" in output ? output.details : null, "chat image tool");
  }
  return null;
}

export function reconcileBrowserGuestAiRefusal(
  refusal: BrowserGuestAiRefusal,
  refreshedUsage: AiUsageStatus | null,
  capabilities: BrowserGuestCapabilities | null,
): BrowserGuestAiRefusal | null {
  if (refreshedUsage !== null) {
    return getBrowserGuestAiAdmissionRefusal(refreshedUsage, capabilities, refusal.feature);
  }
  return refusal.scope === "shared" && refusal.resetsAt !== null && Date.parse(refusal.resetsAt) <= Date.now()
    ? null : refusal;
}

export function formatBrowserGuestAiRefusal(refusal: BrowserGuestAiRefusal, t: AiLimitReachedMessageParams["t"]): string {
  if (refusal.scope === "sign_in") return t("guest.aiSignIn");
  return t(refusal.scope === "shared" ? "guest.aiTrialSharedExhausted" : "guest.aiTrialExhausted");
}
