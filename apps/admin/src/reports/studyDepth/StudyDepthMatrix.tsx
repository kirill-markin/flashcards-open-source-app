import type { JSX } from "react";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import { escapeHtml } from "../../charts/formatting";
import { ExplanationTip } from "../../explanations/ExplanationTip";
import { formatShare, minReliablePeopleCount } from "./reachBars";
import {
  getMatrixCellFillPercent,
  minMatrixFillShare,
  studyDepthMatrixReviewDayEdges,
  studyDepthMatrixReviewEdges,
  type MatrixCell,
  type MatrixRow,
  type StudyDepthMatrix as StudyDepthMatrixModel,
} from "./reachMatrix";
import { studyDepthMatrixModes, type StudyDepthMatrixMode } from "./studyDepthUrl";

const integerFormatter = new Intl.NumberFormat("en-US");

const matrixModeLabels: Readonly<Record<StudyDepthMatrixMode, string>> = {
  "at-least": "At least (reached)",
  exactly: "Exactly (bucket)",
};

const matrixModeNotes: Readonly<Record<StudyDepthMatrixMode, string>> = {
  "at-least": "The top row equals the review-days chart and the left column the reviews chart.",
  exactly: "Everybody is in exactly one cell, so the cells add up to the cohort.",
};

function buildMatrixCellTooltipHtml(row: MatrixRow, cell: MatrixCell): string {
  const rows = [
    `<p class="tooltip-title">${escapeHtml(`${row.reviewBand.label} reviews and ${cell.reviewDayBand.label} review days`)}</p>`,
    `<div class="tooltip-metric"><span>People</span><strong>${integerFormatter.format(cell.peopleCount)}</strong></div>`,
    `<div class="tooltip-metric"><span>Of cohort</span><strong>${formatShare(cell.shareOfCohort)}</strong></div>`,
  ];
  if (cell.peopleCount > 0 && !cell.isReliable) {
    rows.push(`<p class="tooltip-hint">Fewer than ${minReliablePeopleCount} people, too few to read as a rate.</p>`);
  }

  return rows.join("");
}

function getMatrixCellClassName(cell: MatrixCell): string {
  if (cell.peopleCount === 0) {
    return "study-depth-matrix-cell study-depth-matrix-cell-empty";
  }

  return cell.isReliable ? "study-depth-matrix-cell" : "study-depth-matrix-cell study-depth-matrix-cell-unreliable";
}

/** Reviews against review days, counted from the same joint counts as the two charts above it. */
export function StudyDepthMatrix(
  props: Readonly<{
    matrix: StudyDepthMatrixModel | null;
    mode: StudyDepthMatrixMode;
    onSelectMode: (mode: StudyDepthMatrixMode) => void;
    note: string | null;
  }>,
): JSX.Element {
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const { matrix } = props;

  return (
    <section className="chart-column study-depth-chart-column" data-testid="study-depth-matrix">
      <div className="chart-shell">
        <div className="chart-meta">
          <div className="explained-heading-row">
            <h3>Reviews and review days together</h3>
            <ExplanationTip label="How the reviews and review days matrix is counted" explanationId="study-depth-matrix-explanation">
              <ul>
                <li><strong>At least:</strong> each cell is the people in the cohort with at least that many reviews and at least that many review days, as a count and a share of the cohort</li>
                <li><strong>Exactly:</strong> each cell is the people whose totals now fall inside both that row&rsquo;s and that column&rsquo;s bucket; a bucket runs from its edge up to the next one, and the last has no end</li>
                <li>Fixed edges, so two selections compare cell by cell. Rows, reviews: {studyDepthMatrixReviewEdges.join(", ")}. Columns, review days: {studyDepthMatrixReviewDayEdges.join(", ")}</li>
                <li>The color is the share of the cohort on a log scale, palest at {formatShare(minMatrixFillShare)} or less; an empty cell is dashed</li>
                <li>A cell with fewer than {minReliablePeopleCount} people is faded: too few people to read as a rate</li>
                <li>Same cohort, filters and counts as the two charts above</li>
              </ul>
            </ExplanationTip>
          </div>
          <span className="chart-meta-right">At least: reached both. Exactly: where people are now</span>
        </div>
        <div className="study-depth-matrix-modes" role="group" aria-label="How a cell counts people">
          {studyDepthMatrixModes.map((option) => (
            <button
              key={option}
              className={option === props.mode
                ? "filter-button filter-button-compact study-depth-mode-selected"
                : "filter-button filter-button-compact"}
              type="button"
              data-testid={`study-depth-matrix-${option}`}
              aria-pressed={option === props.mode}
              onClick={() => props.onSelectMode(option)}
            >{matrixModeLabels[option]}</button>
          ))}
        </div>
        <div className="chart-scroll">
          {matrix === null ? (
            props.note === null ? null : <p className="study-depth-matrix-placeholder">{props.note}</p>
          ) : (
            <table className="study-depth-matrix">
              <colgroup>
                <col className="study-depth-matrix-label-col" />
                <col span={matrix.reviewDayBands.length} />
              </colgroup>
              <thead>
                <tr>
                  <td />
                  <th scope="colgroup" colSpan={matrix.reviewDayBands.length} className="study-depth-matrix-axis">review days →</th>
                </tr>
                <tr>
                  <th scope="col" className="study-depth-matrix-corner">reviews ↓</th>
                  {matrix.reviewDayBands.map((band) => (
                    <th key={band.label} scope="col" aria-label={`${band.label} review days`}>{band.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.reviewBand.label}>
                    <th scope="row" aria-label={`${row.reviewBand.label} reviews`}>{row.reviewBand.label}</th>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.reviewDayBand.label}
                        className={getMatrixCellClassName(cell)}
                        style={cell.peopleCount === 0
                          ? undefined
                          : { background: `color-mix(in srgb, var(--accent) ${getMatrixCellFillPercent(cell.shareOfCohort)}%, transparent)` }}
                        onMouseMove={(event) => tooltipHandlers.showTooltip(buildMatrixCellTooltipHtml(row, cell), event.clientX, event.clientY)}
                        onMouseLeave={tooltipHandlers.hideTooltip}
                      >
                        {cell.peopleCount === 0 ? "–" : (
                          <>
                            <span className="study-depth-matrix-count">{integerFormatter.format(cell.peopleCount)}</span>
                            <span className="study-depth-matrix-share">{formatShare(cell.shareOfCohort)}</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {matrix === null ? null : <p className="chart-notes-key">{matrixModeNotes[props.mode]}</p>}
      </div>
      <ChartTooltip {...tooltipState} />
    </section>
  );
}
