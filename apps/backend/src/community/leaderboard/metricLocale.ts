import { parseUiCopyLocale, resolveSpecializedUiCopyLocale } from "../../uiCopyLocale";
import { resolveAnonymousDisplayNameLocale, type AnonymousDisplayNameLocale } from "../anonymousDisplayNames";

export type LeaderboardMetricLocale = AnonymousDisplayNameLocale | "ms" | "or" | "pt-PT" | "zh-Hant";

export function resolveLeaderboardMetricLocale(localeHint: string): LeaderboardMetricLocale {
  const locale = parseUiCopyLocale(localeHint);
  const specializedLocale = locale === null ? null : resolveSpecializedUiCopyLocale(locale);
  switch (specializedLocale) {
    case "ms":
    case "or":
    case "pt-PT":
    case "zh-Hant":
      return specializedLocale;
    default:
      return resolveAnonymousDisplayNameLocale(localeHint);
  }
}
