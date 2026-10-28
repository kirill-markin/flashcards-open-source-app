import { useCallback, useState, type JSX } from "react";
import type { FunnelReportProps } from "../funnels/funnelSections";
import { parseReportPeriod, reportPeriodLabels, reportPeriods, type ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { WhoCameBackBreakdownSections } from "../whoCameBack/WhoCameBackBreakdownSections";
import { WhoCameBackSection } from "../whoCameBack/WhoCameBackSection";
import type { RetentionCurveCohortFilters } from "./query";
import { AppOpenRetentionCurveSection, StudiedRetentionCurveSection } from "./RetentionCurveSections";
import { parseRetentionDetailsPeriod, writeRetentionDetailsPeriodToUrl } from "./retentionDetailsUrl";

const retentionDetailsGroupByFieldId = "retention-details-group-by";

/**
 * The Retention card without its Details button and the app-open curve, both on the Journeys
 * selection; then, under the page's own Group by, the first-use cohort chart and its breakdowns,
 * which read only the date range.
 */
export function RetentionDetailsPage(
  props: FunnelReportProps & Readonly<{ cohortFilters: RetentionCurveCohortFilters }>,
): JSX.Element {
  const [period, setPeriod] = useState<ReportPeriod>(
    () => parseRetentionDetailsPeriod(new URLSearchParams(window.location.search)),
  );

  const selectPeriod = useCallback((nextPeriod: ReportPeriod): void => {
    setPeriod(nextPeriod);
    writeRetentionDetailsPeriodToUrl(nextPeriod);
  }, []);

  return (
    <>
      <div className="level-1-metrics-grid">
        <StudiedRetentionCurveSection
          config={props.config}
          dateRange={props.filters.dateRange}
          cohortFilters={props.cohortFilters}
          comparisonDateRange={props.filters.comparisonDateRange}
          isRangeLoading={props.isRangeLoading}
          onDetailsNavigate={null}
          onTerminalAdminError={props.onTerminalAdminError}
        />
        <AppOpenRetentionCurveSection
          config={props.config}
          dateRange={props.filters.dateRange}
          cohortFilters={props.cohortFilters}
          comparisonDateRange={props.filters.comparisonDateRange}
          isRangeLoading={props.isRangeLoading}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      </div>

      <div className="funnel-group-by-row">
        <div className="funnel-group-by">
          <label htmlFor={retentionDetailsGroupByFieldId}>Group by</label>
          <select
            id={retentionDetailsGroupByFieldId}
            className="funnel-group-by-select"
            data-testid={retentionDetailsGroupByFieldId}
            value={period}
            onChange={(event) => selectPeriod(parseReportPeriod(event.target.value))}
          >
            {reportPeriods.map((option) => (
              <option key={option} value={option}>{reportPeriodLabels[option]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="level-1-metrics-grid">
        <WhoCameBackSection
          config={props.config}
          dateRange={props.filters.dateRange}
          period={period}
          onTerminalAdminError={props.onTerminalAdminError}
        />
        <WhoCameBackBreakdownSections
          config={props.config}
          dateRange={props.filters.dateRange}
          period={period}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      </div>
    </>
  );
}
