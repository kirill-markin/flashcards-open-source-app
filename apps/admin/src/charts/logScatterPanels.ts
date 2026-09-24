import * as d3 from "d3";
import type { ChartTooltipHandlers } from "./chartPrimitives";

// One small-multiple scatter panel: two logarithmic axes, a marked zero strip at the edge of each,
// and the panel's own median lines. It lives beside the other chart primitives rather than inside the
// report that uses it because everything here is about the shape of the chart and nothing about what
// is being plotted.
//
// SMALL MULTIPLES ONLY WORK ON ONE SET OF SCALES. This renderer therefore takes its domains rather
// than deriving them: the caller computes one pair over every panel's dots with
// `buildLogScatterDomain` and hands the same pair to each panel. Panels drawn to their own extents
// cannot be compared, which is the entire reason a reader is looking at a row of them.
//
// EXACT ZEROS CANNOT SIT ON A LOG AXIS, and dropping them is not an option: on this dashboard the
// people who did none of the thing are usually most of the panel and are the most informative part of
// it. Each axis therefore carries a zero strip at its low edge, separated from the logarithmic region
// by a dashed rule, and a zero is drawn inside that strip with a jitter along the collapsed axis so
// that overlapping people stay countable. The strip is labelled `0` in bold, so it can never be
// misread as the first decade.

const panelWidth = 352;
const panelHeight = 232;

const plotLeft = 52;
const plotRight = 342;
const plotTop = 8;
const plotBottom = 206;

/** The width of the zero strip and the gap that keeps a jittered zero clear of the dashed rule. */
const zeroStripThickness = 22;
const zeroStripGap = 3;
const zeroStripThicknessY = 18;

const xZeroDividerX = plotLeft + zeroStripThickness;
const xLogLeft = xZeroDividerX + zeroStripGap;
const xZeroCenter = (plotLeft + xZeroDividerX) / 2;

const yZeroDividerY = plotBottom - zeroStripThicknessY;
const yLogBottom = yZeroDividerY - zeroStripGap;
const yZeroCenter = (plotBottom + yZeroDividerY) / 2;

/** Jitter fills most of a strip without letting a dot touch either of its edges. */
const xZeroJitterAmplitude = 6;
const yZeroJitterAmplitude = 5;

const dotRadius = 2.6;
const dotFillOpacity = 0.5;

/**
 * The single hue every dot takes. There is one series here, so the chart carries no legend and this
 * colour means "a person" and nothing else; it is deliberately not the accent, which the median lines
 * need so that they read as annotation over the cloud rather than as more of it.
 */
const scatterDotColor = "#3987e5";

const tickLabelOffsetY = 15;
const tickLabelBaselineNudge = 3.5;
const tickLabelGutter = 6;

/** One person in one panel. `key` is the jitter seed, so a redraw never moves the zero clouds. */
export type LogScatterDot = Readonly<{
  key: string;
  /** Zero is drawn in the strip; anything above zero is placed on the log axis. Never negative. */
  x: number;
  y: number;
  tooltipHtml: string;
}>;

/** A median the panel draws, or `null` where the panel has nobody to take one over. */
export type LogScatterMedians = Readonly<{
  x: number | null;
  y: number | null;
}>;

export type LogScatterDomain = readonly [number, number];

export type RenderLogScatterPanelParams = Readonly<{
  svgElement: SVGSVGElement;
  dots: ReadonlyArray<LogScatterDot>;
  medians: LogScatterMedians;
  xDomain: LogScatterDomain;
  yDomain: LogScatterDomain;
  ariaLabel: string;
  tooltipHandlers: ChartTooltipHandlers;
}>;

/**
 * The shared domain of one axis: whole decades wide enough to hold every positive value given.
 *
 * It is derived rather than fixed so the panels keep fitting as the product grows, and it is rounded
 * out to powers of ten rather than to the data's own extent so that every tick is a decade and the
 * two axes read the same way. Zeros are not in it - they live in the strip - and a value below the
 * low end cannot occur, because the low end is the decade below the smallest positive value.
 */
export function buildLogScatterDomain(
  values: ReadonlyArray<number>,
  fallback: LogScatterDomain,
): LogScatterDomain {
  const positiveValues = values.filter((value) => value > 0 && Number.isFinite(value));
  if (positiveValues.length === 0) {
    return fallback;
  }

  // Reduced rather than spread into `Math.min`: a panel set can hold tens of thousands of dots, and
  // spreading that many arguments overflows the call stack.
  const smallest = positiveValues.reduce((left, right) => (right < left ? right : left));
  const largest = positiveValues.reduce((left, right) => (right > left ? right : left));
  const low = Math.pow(10, Math.floor(Math.log10(smallest)));
  const high = Math.pow(10, Math.ceil(Math.log10(largest)));
  // A single value sits exactly on a power of ten and would otherwise ask for a zero-width domain.
  return high > low ? [low, high] : [low, low * 10];
}

/** Every power of ten the domain covers, which is the only tick a decade axis should carry. */
function buildDecadeTicks(domain: LogScatterDomain): ReadonlyArray<number> {
  const lowExponent = Math.round(Math.log10(domain[0]));
  const highExponent = Math.round(Math.log10(domain[1]));
  const ticks: Array<number> = [];
  for (let exponent = lowExponent; exponent <= highExponent; exponent += 1) {
    ticks.push(Math.pow(10, exponent));
  }

  return ticks;
}

/** `0.1`, `1`, `100`, then `1k`, `10k`, `1M`: short enough to sit under a panel this narrow. */
function formatDecadeTick(value: number): string {
  if (value >= 1_000_000_000) {
    return `${value / 1_000_000_000}B`;
  }

  if (value >= 1_000_000) {
    return `${value / 1_000_000}M`;
  }

  if (value >= 1_000) {
    return `${value / 1_000}k`;
  }

  return `${value}`;
}

/**
 * A stable pseudo-random offset in `[-amplitude, amplitude]`, keyed on the dot and the axis.
 *
 * It is seeded rather than random because this chart is redrawn whenever React re-renders it, and an
 * unseeded jitter would make the zero clouds crawl between renders - which reads as movement in the
 * data. FNV-1a over the key is enough: nothing here needs statistical quality, only that one person
 * lands in the same place every time and that two people rarely land in the same one.
 */
function buildStableJitter(key: string, axis: string, amplitude: number): number {
  const seed = `${axis}:${key}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16_777_619);
  }

  const unitInterval = (hash >>> 0) / 4_294_967_296;
  return (unitInterval - 0.5) * 2 * amplitude;
}

export function renderLogScatterPanel(params: RenderLogScatterPanelParams): void {
  const svg = d3.select(params.svgElement);
  svg.selectAll("*").remove();
  // `classed` rather than `attr`, so the caller's own class on the element survives the redraw.
  svg.classed("log-scatter-panel", true)
    .attr("viewBox", `0 0 ${panelWidth} ${panelHeight}`)
    .attr("role", "img")
    .attr("aria-label", params.ariaLabel);

  const x = d3.scaleLog().domain([...params.xDomain]).range([xLogLeft, plotRight]).clamp(true);
  const y = d3.scaleLog().domain([...params.yDomain]).range([yLogBottom, plotTop]).clamp(true);
  const xTicks = buildDecadeTicks(params.xDomain);
  const yTicks = buildDecadeTicks(params.yDomain);

  const grid = svg.append("g").attr("class", "grid");
  xTicks.forEach((tick) => {
    grid.append("line")
      .attr("x1", x(tick)).attr("x2", x(tick))
      .attr("y1", plotTop).attr("y2", plotBottom);
  });
  yTicks.forEach((tick) => {
    grid.append("line")
      .attr("x1", plotLeft).attr("x2", plotRight)
      .attr("y1", y(tick)).attr("y2", y(tick));
  });

  const axes = svg.append("g").attr("class", "axis");
  xTicks.forEach((tick) => {
    axes.append("text")
      .attr("x", x(tick)).attr("y", plotBottom + tickLabelOffsetY)
      .attr("text-anchor", "middle")
      .text(formatDecadeTick(tick));
  });
  yTicks.forEach((tick) => {
    axes.append("text")
      .attr("x", plotLeft - tickLabelGutter).attr("y", y(tick) + tickLabelBaselineNudge)
      .attr("text-anchor", "end")
      .text(formatDecadeTick(tick));
  });

  // The zero labels are bold so that the strip reads as its own category rather than as the first
  // decade of the axis it sits beside.
  axes.append("text")
    .attr("class", "log-scatter-zero-label")
    .attr("x", xZeroCenter).attr("y", plotBottom + tickLabelOffsetY)
    .attr("text-anchor", "middle")
    .text("0");
  axes.append("text")
    .attr("class", "log-scatter-zero-label")
    .attr("x", plotLeft - tickLabelGutter).attr("y", plotBottom - 2)
    .attr("text-anchor", "end")
    .text("0");

  const dividers = svg.append("g").attr("class", "log-scatter-zero-divider");
  dividers.append("line")
    .attr("x1", xZeroDividerX).attr("x2", xZeroDividerX)
    .attr("y1", plotTop).attr("y2", plotBottom);
  dividers.append("line")
    .attr("x1", plotLeft).attr("x2", plotRight)
    .attr("y1", yZeroDividerY).attr("y2", yZeroDividerY);

  svg.append("g")
    .selectAll("circle")
    .data([...params.dots])
    .join("circle")
    .attr("class", "log-scatter-dot")
    .attr("cx", (dot) => (dot.x <= 0
      ? xZeroCenter + buildStableJitter(dot.key, "x", xZeroJitterAmplitude)
      : x(dot.x)))
    .attr("cy", (dot) => (dot.y <= 0
      ? yZeroCenter + buildStableJitter(dot.key, "y", yZeroJitterAmplitude)
      : y(dot.y)))
    .attr("r", dotRadius)
    .attr("fill", scatterDotColor)
    .attr("fill-opacity", dotFillOpacity)
    .on("mousemove", (event: MouseEvent, dot: LogScatterDot) => {
      params.tooltipHandlers.showTooltip(dot.tooltipHtml, event.clientX, event.clientY);
    })
    .on("mouseleave", () => {
      params.tooltipHandlers.hideTooltip();
    });

  // Medians last but one, so they read over the cloud they describe. Each spans the whole plot,
  // including the zero strips, because it is a value of the axis and not of the log region alone.
  // A median of exactly zero is drawn inside the strip rather than left out: on this data that is a
  // real and frequent answer, and an absent line would read as an unmeasured panel.
  const medians = svg.append("g").attr("class", "log-scatter-median");
  const medianX = params.medians.x;
  const medianY = params.medians.y;
  if (medianX !== null) {
    const positionX = medianX <= 0 ? xZeroCenter : x(medianX);
    medians.append("line")
      .attr("x1", positionX).attr("x2", positionX)
      .attr("y1", plotTop).attr("y2", plotBottom);
  }

  if (medianY !== null) {
    const positionY = medianY <= 0 ? yZeroCenter : y(medianY);
    medians.append("line")
      .attr("x1", plotLeft).attr("x2", plotRight)
      .attr("y1", positionY).attr("y2", positionY);
  }

  svg.append("rect")
    .attr("class", "log-scatter-frame")
    .attr("x", plotLeft).attr("y", plotTop)
    .attr("width", plotRight - plotLeft).attr("height", plotBottom - plotTop);
}
