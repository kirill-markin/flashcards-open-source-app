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
 * The funnels in page order. Each funnel's query states who it counts as a person and how its steps
 * count.
 *
 * A FUNNEL EXISTS FOR ONE MAIN USER FLOW, and each of its steps is written as the designed path rather
 * than as a union of every way that step could be reached. Where a flow genuinely splits, it becomes
 * its own funnel with its own first step.
 *
 * Each funnel also counts entries only from a fixed start date in its query, so no selection shows a
 * partial first day, and a funnel with a seven-day window warns while some entries are still inside it.
 */
export const funnelSections: ReadonlyArray<FunnelSectionDefinition> = [
  { anchor: firstLaunchFunnelAnchor, Section: FirstLaunchFunnelSection },
  { anchor: catalogInstallFunnelAnchor, Section: CatalogInstallFunnelSection },
  { anchor: blogPlatformChoiceFunnelAnchor, Section: BlogPlatformChoiceFunnelSection },
  { anchor: signInFunnelAnchor, Section: SignInFunnelSection },
  { anchor: paywallFunnelAnchor, Section: PaywallFunnelSection },
];
