import type { JSX } from "react";
import { getAnalyticsAreaPath, type FunnelDetail } from "../../routing";
import { firstLaunchFunnelTitle } from "../firstLaunchFunnel/FirstLaunchFunnelSection";
import { studiedRetentionCurveTitle } from "../retentionCurve/RetentionCurveSections";
import type { JourneysPage } from "./FunnelsArea";
import { FunnelsLink } from "./FunnelsLink";

const funnelDetailTitles: Readonly<Record<FunnelDetail, string>> = {
  "first-launch": firstLaunchFunnelTitle,
};

/** The back link and title above a Journeys Details page, laid out like a Level 1 one. */
export function FunnelDetailsHeader(
  props: Readonly<{
    page: Exclude<JourneysPage, Readonly<{ kind: "cards" }>>;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  const title = props.page.kind === "retentionDetails"
    ? studiedRetentionCurveTitle
    : funnelDetailTitles[props.page.funnelId];

  return (
    <header className="level-1-metric-details-header">
      <FunnelsLink
        className="state-link"
        path={getAnalyticsAreaPath("journeys")}
        testId="funnel-details-back"
        onNavigate={props.onNavigate}
      >← Journeys</FunnelsLink>
      <h2 data-testid="funnel-details-title">{title} details</h2>
    </header>
  );
}
