import { useEffect, useMemo, useRef, type JSX } from "react";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import type { ChartTooltipHandlers } from "../../charts/chartPrimitives";
import { escapeHtml } from "../../charts/formatting";
import {
  buildLogScatterDomain,
  renderLogScatterPanel,
  type LogScatterDomain,
  type LogScatterDot,
} from "../../charts/logScatterPanels";
import type { AiUsagePanel, AiUsagePoint } from "./panels";

// The small multiples and their captions. One panel per period, every panel on the same pair of
// scales, and each one carrying the three numbers that say what its cloud is: how many people are in
// it, how many of them never reviewed, and where its two medians sit.

/** A domain to fall back on when a panel set has no positive value on that axis at all. */
const emptyReviewRateDomain: LogScatterDomain = [0.1, 100];
const emptyCharRateDomain: LogScatterDomain = [1, 100_000];

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatReviewRate(value: number): string {
  return value.toFixed(1);
}

export function formatCharRate(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : integerFormatter.format(Math.round(value));
}

export function formatSharePercentage(count: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((count / total) * 100)}%`;
}

function formatPeriodDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

export function formatPeriodSpan(panel: AiUsagePanel): string {
  return `${formatPeriodDay(panel.period.from)} – ${formatPeriodDay(panel.period.to)}`;
}

function buildDotTooltipHtml(point: AiUsagePoint): string {
  const dot = point.dot;
  return [
    `<p class="tooltip-title">${escapeHtml(dot.actorEmail === "" ? "(no email)" : dot.actorEmail)}</p>`,
    `<p class="tooltip-subtitle">${dot.isRegistered ? "Registered" : "Guest"}</p>`,
    `<p class="tooltip-user-secondary">${escapeHtml(dot.actorId)}</p>`,
    `<div class="tooltip-metric"><span>Reviews per week</span><strong>${formatReviewRate(point.reviewRate)}</strong></div>`,
    `<div class="tooltip-metric"><span>Chat characters per week</span><strong>${integerFormatter.format(Math.round(point.charRate))}</strong></div>`,
    `<div class="tooltip-metric"><span>Reviews in period</span><strong>${integerFormatter.format(dot.reviews)}</strong></div>`,
    `<div class="tooltip-metric"><span>Chat characters in period</span><strong>${integerFormatter.format(dot.chatChars)}</strong></div>`,
    `<div class="tooltip-metric"><span>Typed by the person</span><strong>${integerFormatter.format(dot.promptChars)}</strong></div>`,
    `<div class="tooltip-metric"><span>Written by the model</span><strong>${integerFormatter.format(dot.responseChars)}</strong></div>`,
    `<div class="tooltip-metric"><span>Chat messages</span><strong>${integerFormatter.format(dot.chatMessages)}</strong></div>`,
    `<div class="tooltip-metric"><span>Exposure in period</span><strong>${integerFormatter.format(dot.exposureDays)} days</strong></div>`,
  ].join("");
}

/** The caption's median clause, which always names the population the review median is over. */
function buildPanelMedianLabel(panel: AiUsagePanel): string {
  const reviewMedian = panel.medianReviewRateAmongReviewers === null
    ? "no reviewers"
    : `${formatReviewRate(panel.medianReviewRateAmongReviewers)}/wk among reviewers`;
  const charMedian = panel.medianCharRate === null
    ? "no people"
    : `${formatCharRate(panel.medianCharRate)} chars`;
  return `med ${reviewMedian}, ${charMedian}`;
}

function AiUsagePanelFigure(
  props: Readonly<{
    panel: AiUsagePanel;
    xDomain: LogScatterDomain;
    yDomain: LogScatterDomain;
    tooltipHandlers: ChartTooltipHandlers;
  }>,
): JSX.Element {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const panel = props.panel;
  const dots = useMemo<ReadonlyArray<LogScatterDot>>(() => panel.points.map((point) => ({
    key: `${point.dot.periodIndex}:${point.dot.actorId}`,
    x: point.reviewRate,
    y: point.charRate,
    tooltipHtml: buildDotTooltipHtml(point),
  })), [panel.points]);
  const spanLabel = formatPeriodSpan(panel);

  useEffect(() => {
    const svgElement = chartRef.current;
    if (svgElement === null) {
      return;
    }

    renderLogScatterPanel({
      svgElement,
      dots,
      medians: {
        x: panel.medianReviewRateAmongReviewers,
        y: panel.medianCharRate,
      },
      xDomain: props.xDomain,
      yDomain: props.yDomain,
      ariaLabel: `${spanLabel}: ${panel.peopleCount} people, one dot each, reviews per week against chat characters per week`,
      tooltipHandlers: props.tooltipHandlers,
    });
  }, [
    dots,
    panel.medianCharRate,
    panel.medianReviewRateAmongReviewers,
    panel.peopleCount,
    props.tooltipHandlers,
    props.xDomain,
    props.yDomain,
    spanLabel,
  ]);

  return (
    <figure className="ai-usage-panel">
      <figcaption className="ai-usage-panel-caption">
        <span className="ai-usage-panel-title">{panel.period.index + 1}. {spanLabel}</span>
        <span className="ai-usage-panel-stats">
          {integerFormatter.format(panel.peopleCount)} people
          {" · "}
          <strong>{formatSharePercentage(panel.neverReviewedCount, panel.peopleCount)} never reviewed</strong>
          {" · "}
          {buildPanelMedianLabel(panel)}
        </span>
      </figcaption>
      <svg ref={chartRef} className="ai-usage-panel-chart" />
    </figure>
  );
}

export function AiUsagePanels(props: Readonly<{ panels: ReadonlyArray<AiUsagePanel> }>): JSX.Element {
  const { tooltipState, tooltipHandlers } = useChartTooltip();
  const panels = props.panels;
  // ONE PAIR OF SCALES FOR EVERY PANEL, taken over every panel's dots at once. This is the whole
  // premise of the report: a panel drawn to its own extents would show a cloud in the middle of its
  // own square whatever the cloud was, and comparing two of them would be meaningless.
  const xDomain = useMemo(() => buildLogScatterDomain(
    panels.flatMap((panel) => panel.points.map((point) => point.reviewRate)),
    emptyReviewRateDomain,
  ), [panels]);
  const yDomain = useMemo(() => buildLogScatterDomain(
    panels.flatMap((panel) => panel.points.map((point) => point.charRate)),
    emptyCharRateDomain,
  ), [panels]);

  return (
    <>
      <div className="ai-usage-panel-grid">
        {panels.map((panel) => (
          <AiUsagePanelFigure
            key={panel.period.index}
            panel={panel}
            xDomain={xDomain}
            yDomain={yDomain}
            tooltipHandlers={tooltipHandlers}
          />
        ))}
      </div>
      <p className="ai-usage-axis-caption">
        Horizontal: reviews per week → · Vertical: chat characters per week ↑ · Both axes are
        logarithmic, and the marked <strong>0</strong> strip past the dashed rule on each one holds the
        people whose value is exactly zero, spread out so they stay countable.
      </p>
      <ChartTooltip {...tooltipState} />
    </>
  );
}
