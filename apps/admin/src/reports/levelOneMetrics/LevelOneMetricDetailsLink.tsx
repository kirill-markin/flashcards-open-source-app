import type { JSX } from "react";
import { AdminLink } from "../../navigation/AdminLink";
import { getLevelOneMetricDetailsPath, type LevelOneMetricDetail } from "../../routing";

/** Where a Level 1 section's Details button leads; a section without one renders no button. */
export type LevelOneMetricDetailsLink = Readonly<{
  path: string;
  testId: string;
  onNavigate: (path: string) => void;
}>;

export function buildLevelOneMetricDetailsLink(
  metric: LevelOneMetricDetail,
  search: string,
  onNavigate: (path: string) => void,
): LevelOneMetricDetailsLink {
  return {
    path: `${getLevelOneMetricDetailsPath(metric)}${search}`,
    testId: `${metric}-details-link`,
    onNavigate,
  };
}

export function LevelOneMetricDetailsButton(
  props: Readonly<{ link: LevelOneMetricDetailsLink }>,
): JSX.Element {
  return (
    <AdminLink
      className="filter-button filter-button-compact level-1-metric-details-link"
      path={props.link.path}
      testId={props.link.testId}
      onNavigate={props.link.onNavigate}
    >Details</AdminLink>
  );
}
