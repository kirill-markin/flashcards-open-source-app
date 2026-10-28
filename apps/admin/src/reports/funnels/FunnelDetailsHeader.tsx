import type { JSX } from "react";
import { getAnalyticsAreaPath, type FunnelDetail } from "../../routing";
import { firstLaunchFunnelTitle } from "../firstLaunchFunnel/FirstLaunchFunnelSection";
import { FunnelsLink } from "./FunnelsLink";

const funnelDetailTitles: Readonly<Record<FunnelDetail, string>> = {
  "first-launch": firstLaunchFunnelTitle,
};

/** The back link and title above a funnel Details page, laid out like a Level 1 one. */
export function FunnelDetailsHeader(
  props: Readonly<{
    funnelId: FunnelDetail;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  return (
    <header className="level-1-metric-details-header">
      <FunnelsLink
        className="state-link"
        path={getAnalyticsAreaPath("journeys")}
        testId="funnel-details-back"
        onNavigate={props.onNavigate}
      >← Journeys</FunnelsLink>
      <h2 data-testid="funnel-details-title">{funnelDetailTitles[props.funnelId]} details</h2>
    </header>
  );
}
