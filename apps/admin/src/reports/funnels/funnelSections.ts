import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  BlogPlatformChoiceFunnelSection,
  blogPlatformChoiceFunnelAnchor,
} from "../blogFunnels/BlogPlatformChoiceFunnelSection";
import {
  CatalogInstallFunnelSection,
  catalogInstallFunnelAnchor,
} from "../catalogInstallFunnel/CatalogInstallFunnelSection";
import {
  FirstLaunchFunnelSection,
  firstLaunchFunnelAnchor,
} from "../firstLaunchFunnel/FirstLaunchFunnelSection";
import {
  PaywallFunnelSection,
  paywallFunnelAnchor,
} from "../paywallFunnel/PaywallFunnelSection";
import {
  SignInFunnelSection,
  signInFunnelAnchor,
} from "../signInFunnel/SignInFunnelSection";
import type { FunnelAnchor } from "./funnelAnchorUrl";

/** What a funnel card loads its report from. */
export type FunnelReportProps = Readonly<{
  config: AdminAppConfig;
  /** The selection the Funnels area applies; each funnel applies the fields it can answer and says which it cannot. */
  filters: AnalyticsFilterState;
  /** The shared selection is still settling after a filter change; a funnel waits it out rather than querying per click. */
  isRangeLoading: boolean;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

export type FunnelSectionProps = FunnelReportProps & Readonly<{
  /** Follows the card's Details link; `null` on the funnel's own Details page, which draws no Details button. */
  onDetailsNavigate: ((path: string) => void) | null;
}>;

export type FunnelSectionDefinition = Readonly<{
  anchor: FunnelAnchor<string>;
  Section: (props: FunnelSectionProps) => JSX.Element;
}>;

/**
 * THE FUNNEL RULE, which every funnel here follows: each step grows by at most one per person, and a
 * person counts at a step only if the same person reached every earlier step.
 *
 * A FUNNEL EXISTS FOR ONE MAIN USER FLOW, and each of its steps is written as the designed path rather
 * than as a union of every way that step could be reached. The blog funnel is where that bites: every
 * call to action in an article leads to the home page, so "viewed the home page" is a step of the
 * platform-choice funnel, and a blog reader who clicks a footer store badge without ever seeing the home
 * page is deliberately in no funnel at all rather than in a widened one. Widening a step to hold such a
 * bypass would trade a small, knowable gap for a funnel that no longer describes any single path, and it
 * would keep having to be widened again for the next bypass. Where a flow genuinely splits, it becomes
 * its own funnel with its own first step.
 *
 * WHAT A PERSON IS, is the one thing the audience mode changes, and the rule holds unchanged in all
 * three (`funnelAudienceModes` in `apps/admin/src/filters/analyticsFilters.ts` names them; the SQL
 * that expresses each one is in `./funnelAudienceSql.ts`):
 *   - `with-anonymous-id`, the default, is the rule as written above: a person is an
 *     `analytics.product_events_resolved.actor_id`, so a visitor cookie, a mobile guest id or an
 *     account. A cookieless visitor is in no funnel.
 *   - `signed-in` keeps the same person key and drops the actors that never became a real account, so
 *     it narrows the cohort without touching how a step is counted.
 *   - `all` adds a second cohort whose person key is a daily visitor hash on one UTC day, and the rule
 *     holds inside it on that pair: each of those steps is a distinct count over that key, and the
 *     later step is read only for a person the earlier one kept. Those people can reach the site steps
 *     alone, so every step below is identified-only and the two cohorts are simply added per step. A
 *     funnel whose own first step is already below that line does not read the cohort at all rather
 *     than adding it to its base, which would raise the base of steps those people can never appear in.
 *
 * `all` IS AN UPPER BOUND ON PEOPLE, NOT A COUNT OF THEM, which is the one place the rule as written
 * does not survive the mode, and it is why `all` is not the default. A hash and an actor are disjoint
 * on a row - the hash is written only where there is no identifier at all - but they cannot be linked
 * to each other, by design: the salt is unreadable and the pair is never resolved to a cookie id.
 * Where the site must ask before it sets a cookie (the EEA and the UK), one human sends hashed page
 * views before consenting and cookie-bearing ones after, so on that day they can be one hashed person
 * and one identified person at the same step, and the two are added. Step one of the deck funnel is
 * "viewed any deck page", and the blog funnel's step one is an entry page, so either can hold a person
 * on both sides of their own consent click. No SQL here can subtract that overlap; every section that
 * shows the split states it.
 *
 * Each funnel also counts entries only from a fixed start date in its query, so no selection shows a
 * partial first day, and warns while some entries are still inside their seven-day window.
 */
export const funnelSections: ReadonlyArray<FunnelSectionDefinition> = [
  { anchor: firstLaunchFunnelAnchor, Section: FirstLaunchFunnelSection },
  { anchor: catalogInstallFunnelAnchor, Section: CatalogInstallFunnelSection },
  { anchor: blogPlatformChoiceFunnelAnchor, Section: BlogPlatformChoiceFunnelSection },
  { anchor: signInFunnelAnchor, Section: SignInFunnelSection },
  { anchor: paywallFunnelAnchor, Section: PaywallFunnelSection },
];
