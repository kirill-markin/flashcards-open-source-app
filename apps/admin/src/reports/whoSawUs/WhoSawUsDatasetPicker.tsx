import { useState, type JSX, type ReactNode } from "react";
import { AdminLink } from "../../navigation/AdminLink";
import { getAnalyticsAreaPath, getWhoSawUsDatasetPath, whoSawUsDatasets } from "../../routing";
import { LevelOneMetricDetailsHeader } from "../levelOneMetrics/LevelOneMetricDetailsHeader";
import { whoSawUsSeriesLabels } from "./WhoSawUsSection";

const mcpNoteId = "who-saw-us-dataset-mcp-note";

/**
 * The Who saw us Details page: one button per dataset, because its series come from unrelated
 * sources. It loads no range, so it carries the Level 1 selection on as the URL it opened with holds it.
 */
export function WhoSawUsDatasetPicker(
  props: Readonly<{
    onNavigate: (path: string) => void;
    renderNavigation: (levelOneMetricsSearch: string) => ReactNode;
  }>,
): JSX.Element {
  const [search] = useState<string>(() => window.location.search);

  return (
    <>
      {props.renderNavigation(search)}

      <LevelOneMetricDetailsHeader
        backPath={`${getAnalyticsAreaPath("level-1-metrics")}${search}`}
        backLabel="Level 1 metrics"
        title="Who saw us details"
        onNavigate={props.onNavigate}
      />

      <nav className="state-links" aria-label="Who saw us datasets">
        {whoSawUsDatasets.map((dataset) => (
          <AdminLink
            key={dataset}
            className="filter-button level-1-metric-details-link"
            path={`${getWhoSawUsDatasetPath(dataset)}${search}`}
            testId={`who-saw-us-dataset-${dataset}-link`}
            onNavigate={props.onNavigate}
          >{whoSawUsSeriesLabels[dataset]}</AdminLink>
        ))}
        <div className="who-saw-us-dataset-inactive">
          <button
            className="filter-button"
            type="button"
            disabled
            aria-describedby={mcpNoteId}
            data-testid="who-saw-us-dataset-mcp-inactive"
          >MCP</button>
          <span id={mcpNoteId}>MCP clients (ChatGPT and Claude) will be added later.</span>
        </div>
      </nav>
    </>
  );
}
