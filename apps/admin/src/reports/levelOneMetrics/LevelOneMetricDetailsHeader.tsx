import type { JSX } from "react";
import { AdminLink } from "../../navigation/AdminLink";

/** The back link and title above every Level 1 Details page. */
export function LevelOneMetricDetailsHeader(
  props: Readonly<{
    backPath: string;
    backLabel: string;
    title: string;
    onNavigate: (path: string) => void;
  }>,
): JSX.Element {
  return (
    <header className="level-1-metric-details-header">
      <AdminLink
        className="state-link"
        path={props.backPath}
        testId="level-1-metric-details-back"
        onNavigate={props.onNavigate}
      >← {props.backLabel}</AdminLink>
      <h2 data-testid="level-1-metric-details-title">{props.title}</h2>
    </header>
  );
}
