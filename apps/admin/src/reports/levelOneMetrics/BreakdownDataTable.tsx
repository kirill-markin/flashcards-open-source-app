import type { JSX } from "react";
import type { BreakdownReport } from "./breakdownReport";
import { formatReportBucketTitle, reportPeriodColumnLabels } from "./reportPeriod";

export function BreakdownDataTable(props: Readonly<{
  report: BreakdownReport;
  title: string;
  sectionTestId: string;
  formatValue: (value: string) => string;
  formatCount: (count: number) => string;
  inProgressKey: string | null;
  unavailableBarText: string;
}>): JSX.Element {
  const { report } = props;
  return (
    <details className="activity-chart-table">
      <summary>Data table</summary>
      <div className="funnel-group-table-shell" role="region" aria-label={`${props.title} data table`} tabIndex={0}>
        <table className="funnel-group-table" aria-label={props.title} data-testid={`${props.sectionTestId}-table`}>
          <thead>
            <tr>
              <th scope="col">{reportPeriodColumnLabels[report.period]} (UTC)</th>
              {report.values.map((value) => <th scope="col" key={value}>{props.formatValue(value)}</th>)}
              {report.values.length === 0 ? <th scope="col">Status</th> : null}
            </tr>
          </thead>
          <tbody>
            {report.buckets.map(({ bucket, countsByValue, freshness }) => (
              <tr key={bucket.key}>
                <th scope="row">
                  {formatReportBucketTitle(report.period, bucket)}
                  {bucket.key === props.inProgressKey ? " · in progress" : ""}
                </th>
                {countsByValue === null ? (
                  <td colSpan={Math.max(1, report.values.length)}>
                    {freshness === "not-arrived" ? "Not arrived yet." : props.unavailableBarText}
                  </td>
                ) : report.values.length === 0 ? <td>Nothing counted.</td> : (
                  report.values.map((value) => <td key={value}>{props.formatCount(countsByValue.get(value) ?? 0)}</td>)
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
