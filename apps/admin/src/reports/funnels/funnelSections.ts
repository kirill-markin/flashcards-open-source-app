import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import {
  catalogInstallFunnelFilterFields,
  type AnalyticsFilterField,
  type AnalyticsFilterState,
} from "../../filters/analyticsFilters";
import {
  BlogPlatformChoiceFunnelSection,
  blogPlatformChoiceFunnelAnchor,
  blogPlatformChoiceFunnelTitle,
} from "../blogFunnels/BlogPlatformChoiceFunnelSection";
import {
  BlogToWebAppFunnelSection,
  blogToWebAppFunnelAnchor,
  blogToWebAppFunnelTitle,
} from "../blogFunnels/BlogToWebAppFunnelSection";
import {
  CatalogInstallFunnelSection,
  catalogInstallFunnelAnchor,
  catalogInstallFunnelTitle,
} from "../catalogInstallFunnel/CatalogInstallFunnelSection";
import {
  MobileFirstLaunchFunnelSection,
  mobileFirstLaunchFunnelAnchor,
  mobileFirstLaunchFunnelTitle,
} from "../mobileFirstLaunchFunnel/MobileFirstLaunchFunnelSection";
import {
  HomeToWebAppFunnelSection,
  homeToWebAppFunnelAnchor,
  homeToWebAppFunnelTitle,
} from "../siteEntryFunnel/SiteEntryFunnelSection";
import type { FunnelAnchor } from "./funnelAnchorUrl";

export type FunnelSectionProps = Readonly<{
  config: AdminAppConfig;
  /** The whole live selection; each funnel applies the fields it can answer and says which it cannot. */
  filters: AnalyticsFilterState;
  /** A General reload is pending or in flight; a funnel waits it out rather than querying per click. */
  isRangeLoading: boolean;
  /** The funnel's own filter row over `filterFields`, or null when it has none. */
  filterRow: JSX.Element | null;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

export type FunnelSectionDefinition = Readonly<{
  anchor: FunnelAnchor<string>;
  /** The funnel's section heading, which its filter row's heading repeats. */
  title: string;
  /** Fields only this funnel applies, offered in its own row rather than in the area's shared bar. */
  filterFields: ReadonlyArray<AnalyticsFilterField>;
  Section: (props: FunnelSectionProps) => JSX.Element;
}>;

/**
 * Every funnel on the Funnels area, top to bottom. The order is fixed: mobile first launch, home page
 * to web app, deck page to install, blog article to platform choice, blog article to web app. A new
 * funnel is inserted here at its place and nowhere else.
 *
 * THE FUNNEL RULE, which every funnel here follows: each step grows by at most one per person, and a
 * person counts at a step only if the same person reached every earlier step.
 *
 * A FUNNEL EXISTS FOR ONE MAIN USER FLOW, and each of its steps is written as the designed path rather
 * than as a union of every way that step could be reached. The blog funnels are where that bites: every
 * call to action in an article leads to the home page, so "viewed the home page" is a step of the
 * platform-choice funnel, and a blog reader who clicks a footer store badge without ever seeing the home
 * page is deliberately in no funnel at all rather than in a widened one. Widening a step to hold such a
 * bypass would trade a small, knowable gap for a funnel that no longer describes any single path, and it
 * would keep having to be widened again for the next bypass. Where a flow genuinely splits, it becomes
 * its own funnel with its own first step, which is why there are two blog funnels and not one.
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
 *     than adding it to its base: that is the blog web-app funnel, whose first step is the click, and
 *     counting cookieless clickers there would raise the base of four steps they can never appear in.
 *
 * `all` IS AN UPPER BOUND ON PEOPLE, NOT A COUNT OF THEM, which is the one place the rule as written
 * does not survive the mode, and it is why `all` is not the default. A hash and an actor are disjoint
 * on a row - the hash is written only where there is no identifier at all - but they cannot be linked
 * to each other, by design: the salt is unreadable and the pair is never resolved to a cookie id.
 * Where the site must ask before it sets a cookie (the EEA and the UK), one human sends hashed page
 * views before consenting and cookie-bearing ones after, so on that day they can be one hashed person
 * and one identified person at the same step, and the two are added. Step one of the deck funnel is
 * "viewed any deck page", and a site funnel's step one is an entry page, so either can hold a person
 * on both sides of their own consent click. No SQL here can subtract that overlap; the sections and
 * `docs/admin-app.md` state it wherever they show the split.
 *
 * Each funnel also counts entries only from a fixed start date in its query, so no selection shows a
 * partial first day, and warns while some entries are still inside their seven-day window.
 */
export const funnelSections: ReadonlyArray<FunnelSectionDefinition> = [
  {
    anchor: mobileFirstLaunchFunnelAnchor,
    title: mobileFirstLaunchFunnelTitle,
    filterFields: [],
    Section: MobileFirstLaunchFunnelSection,
  },
  {
    anchor: homeToWebAppFunnelAnchor,
    title: homeToWebAppFunnelTitle,
    filterFields: [],
    Section: HomeToWebAppFunnelSection,
  },
  {
    anchor: catalogInstallFunnelAnchor,
    title: catalogInstallFunnelTitle,
    filterFields: catalogInstallFunnelFilterFields,
    Section: CatalogInstallFunnelSection,
  },
  {
    anchor: blogPlatformChoiceFunnelAnchor,
    title: blogPlatformChoiceFunnelTitle,
    filterFields: [],
    Section: BlogPlatformChoiceFunnelSection,
  },
  {
    anchor: blogToWebAppFunnelAnchor,
    title: blogToWebAppFunnelTitle,
    filterFields: [],
    Section: BlogToWebAppFunnelSection,
  },
];
