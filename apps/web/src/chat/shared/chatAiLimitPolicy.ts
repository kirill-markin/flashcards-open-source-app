import type { DateTimeValue, TranslationKey, TranslationValues } from "../../i18n";
import type { AiUsageAccountKind, AiUsageStatus } from "../../types";

// `AI_LIMIT_REACHED` is the code the backend raises when a signed-in account reaches its AI allowance.
// `GUEST_AI_LIMIT_REACHED` is the backend's guest-only code; it cannot reach the web app,
// whose guest credential is refused on every authenticated surface, and it stays matched only so a
// deployed backend still raising it is handled the same way.
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

/**
 * The refusal is shown at once from the usage the chat already holds, never after a new read. With
 * none held yet, or only last month's, the account copy leaves out the renewal date, and the refusal
 * is an account's because web guest credentials are refused on every surface that can raise the limit.
 */
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
