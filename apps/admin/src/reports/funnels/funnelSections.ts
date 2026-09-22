import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import {
  catalogInstallFunnelFilterFields,
  type AnalyticsFilterField,
  type AnalyticsFilterState,
} from "../../filters/analyticsFilters";
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
 * person counts at a step only if the same person reached every earlier step. It covers people with an
 * identifier; a visitor with no identifier is in no funnel.
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
