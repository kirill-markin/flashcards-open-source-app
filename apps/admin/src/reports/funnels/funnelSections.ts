import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import {
  catalogInstallFunnelFilterFields,
  type AnalyticsFilterField,
  type AnalyticsFilterState,
} from "../../filters/analyticsFilters";
import type { CatalogDeckOption } from "../../filters/optionsQuery";
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
  BlogToWebAppFunnelSection,
  HomeToWebAppFunnelSection,
  blogToWebAppFunnelAnchor,
  blogToWebAppFunnelTitle,
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
  /**
   * The deck versions the `Catalog deck version` field offers, for a funnel that has to print one.
   *
   * It is here rather than inside the filter row because a grouped chart names its own bars: the
   * deck funnel grouped by deck version would otherwise legend five 36-character UUIDs, while the
   * field on the same page names those very values by slug. Every version somebody completed an
   * install of is in the list; a funnel that shows a version outside it falls back to the raw id.
   */
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>;
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
 * to web app, deck page to install, blog article to web app. A new funnel is inserted here at its
 * place and nowhere else.
 *
 * THE FUNNEL RULE, which every funnel here follows: each step grows by at most one per person, and a
 * person counts at a step only if the same person reached every earlier step.
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
 *     alone, so every step below is identified-only and the two cohorts are simply added per step.
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
    anchor: blogToWebAppFunnelAnchor,
    title: blogToWebAppFunnelTitle,
    filterFields: [],
    Section: BlogToWebAppFunnelSection,
  },
];
