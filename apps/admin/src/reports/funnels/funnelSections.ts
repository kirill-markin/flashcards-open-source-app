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
} from "../catalogInstallFunnel/CatalogInstallFunnelSection";
import {
  MobileFirstLaunchFunnelSection,
  mobileFirstLaunchFunnelAnchor,
} from "../mobileFirstLaunchFunnel/MobileFirstLaunchFunnelSection";
import {
  BlogToWebAppFunnelSection,
  HomeToWebAppFunnelSection,
  blogToWebAppFunnelAnchor,
  homeToWebAppFunnelAnchor,
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
  /** Fields only this funnel applies, offered in its own row rather than in the area's shared bar. */
  filterFields: ReadonlyArray<AnalyticsFilterField>;
  Section: (props: FunnelSectionProps) => JSX.Element;
}>;

/**
 * Every funnel on the Funnels area, top to bottom. The order is fixed: mobile first launch, home page
 * to web app, deck page to install, blog article to web app. A new funnel is inserted here at its
 * place and nowhere else.
 */
export const funnelSections: ReadonlyArray<FunnelSectionDefinition> = [
  {
    anchor: mobileFirstLaunchFunnelAnchor,
    filterFields: [],
    Section: MobileFirstLaunchFunnelSection,
  },
  {
    anchor: homeToWebAppFunnelAnchor,
    filterFields: [],
    Section: HomeToWebAppFunnelSection,
  },
  {
    anchor: catalogInstallFunnelAnchor,
    filterFields: catalogInstallFunnelFilterFields,
    Section: CatalogInstallFunnelSection,
  },
  {
    anchor: blogToWebAppFunnelAnchor,
    filterFields: [],
    Section: BlogToWebAppFunnelSection,
  },
];
