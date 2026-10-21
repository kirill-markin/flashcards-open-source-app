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
 * THE FUNNEL RULE: each step grows by at most one per person, and a person counts at a step only if
 * the same person reached every earlier step. Each funnel defines in its own query who it counts as a
 * person and whether its steps follow this rule; there is no global audience switch.
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
