import type * as d3 from "d3";
import type { ReportBucket } from "../reports/levelOneMetrics/reportPeriod";
import type { ChartTooltipHandlers } from "./chartPrimitives";
import { escapeHtml } from "./formatting";

/** A remark on a time chart; `at` is an approximate ISO UTC instant, and a bare date means that day's start. */
export type ChartNote = Readonly<{ at: string; shortText: string; longText: string }>;

/** A note inside a drawn bucket, `fraction` (0–1) of the way across that bucket's selected days. */
export type PlacedChartNote = ChartNote & Readonly<{ number: number; bucketKey: string; fraction: number }>;

type DrawnChartNote = Readonly<{ note: PlacedChartNote; x: number; row: 0 | 1 }>;

const dayMilliseconds = 86_400_000;
const chartNoteInstantPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/u;

// 16 matches the half-width grid's axis text. A 16px circled digit spans about 1 below to 13 above its baseline,
// so both rows fit inside `chartMargin.top` (28).
const chartNoteTagFontSize = 16;
const chartNoteTagRowBaselines = [-1, -15] as const;
const chartNoteTagWidth = 20;
const chartNoteHitWidth = 10;

export function buildInProgressChartNote(today: string): ChartNote {
  return { at: today, shortText: "In progress", longText: "Today in UTC: this bar is still filling." };
}

function parseChartNoteInstant(at: string): number {
  const time = chartNoteInstantPattern.test(at) ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) throw new Error(`A chart note's at must be an ISO UTC date or instant ending in Z, got: ${at}`);
  return time;
}

/** The notes inside the drawn buckets, oldest first and numbered from 1, so the lines and the key agree. */
export function placeChartNotes(
  notes: ReadonlyArray<ChartNote>,
  buckets: ReadonlyArray<ReportBucket>,
): ReadonlyArray<PlacedChartNote> {
  const bucketSpans = buckets.map((bucket) => ({
    bucket,
    start: Date.parse(`${bucket.from}T00:00:00Z`),
    end: Date.parse(`${bucket.to}T00:00:00Z`) + dayMilliseconds,
  }));
  const timedNotes = notes.map((note) => ({ note, time: parseChartNoteInstant(note.at) }))
    .sort((left, right) => left.time - right.time);
  const notesInBuckets = timedNotes.flatMap(({ note, time }) => {
    const span = bucketSpans.find((candidate) => candidate.start <= time && time < candidate.end);
    return span === undefined ? [] : [{ ...note, bucketKey: span.bucket.key, fraction: (time - span.start) / (span.end - span.start) }];
  });
  return notesInBuckets.map((note, index) => ({ ...note, number: index + 1 }));
}

export function formatChartNoteNumber(number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > 20) {
    throw new Error(`A chart note number needs a circled digit, which exists only for 1–20, got: ${number}`);
  }
  return String.fromCodePoint(0x2460 + number - 1);
}

/** The first row whose last tag is a tag width away, else the row whose last tag is farther. */
function chooseChartNoteTagRow(drawn: ReadonlyArray<DrawnChartNote>, noteX: number): 0 | 1 {
  const distanceFromRow = (row: 0 | 1): number => {
    const inRow = drawn.filter((candidate) => candidate.row === row);
    const last = inRow[inRow.length - 1];
    return last === undefined ? Number.POSITIVE_INFINITY : noteX - last.x;
  };
  const distances = [distanceFromRow(0), distanceFromRow(1)] as const;
  if (distances[0] >= chartNoteTagWidth) return 0;
  if (distances[1] >= chartNoteTagWidth) return 1;
  return distances[1] > distances[0] ? 1 : 0;
}

function buildChartNoteTooltipHtml(note: ChartNote): string {
  return `<p class="tooltip-title">${escapeHtml(note.shortText)}</p><p>${escapeHtml(note.longText)}</p>`;
}

/** Call after the bar hit targets, so a note's hover strip wins over the bar under it. */
export function renderChartNotes(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleBand<string>,
  innerHeight: number,
  notes: ReadonlyArray<PlacedChartNote>,
  tooltipHandlers: ChartTooltipHandlers,
): void {
  const drawnNotes = notes.reduce<ReadonlyArray<DrawnChartNote>>((drawn, note) => {
    const bucketX = x(note.bucketKey);
    if (bucketX === undefined) throw new Error(`Chart note "${note.shortText}" falls in bucket ${note.bucketKey}, which the chart does not draw.`);
    const noteX = bucketX + note.fraction * x.bandwidth();
    return [...drawn, { note, x: noteX, row: chooseChartNoteTagRow(drawn, noteX) }];
  }, []);
  const showFocusedTooltip = function(this: SVGRectElement, _event: FocusEvent, drawn: DrawnChartNote): void {
    const bounds = this.getBoundingClientRect();
    tooltipHandlers.showTooltip(buildChartNoteTooltipHtml(drawn.note), bounds.left, bounds.top);
  };
  const noteGroups = group.selectAll<SVGGElement, DrawnChartNote>(".chart-note").data(drawnNotes).join("g")
    .attr("class", "chart-note")
    .on("mousemove", (event: MouseEvent, drawn: DrawnChartNote) => {
      tooltipHandlers.showTooltip(buildChartNoteTooltipHtml(drawn.note), event.clientX, event.clientY);
    })
    .on("mouseleave", tooltipHandlers.hideTooltip);
  noteGroups.append("line").attr("x1", (drawn) => drawn.x).attr("x2", (drawn) => drawn.x)
    .attr("y1", 0).attr("y2", innerHeight).attr("stroke", "currentColor").attr("stroke-dasharray", "6 4");
  noteGroups.append("text").attr("class", "chart-note-tag")
    .attr("x", (drawn) => drawn.x).attr("y", (drawn) => chartNoteTagRowBaselines[drawn.row])
    .attr("font-size", chartNoteTagFontSize).attr("text-anchor", "middle").attr("fill", "currentColor").text((drawn) => formatChartNoteNumber(drawn.note.number));
  noteGroups.append("rect").attr("class", "chart-note-hit")
    .attr("x", (drawn) => drawn.x - chartNoteHitWidth / 2).attr("y", 0)
    .attr("width", chartNoteHitWidth).attr("height", innerHeight)
    .attr("fill", "transparent").attr("tabindex", 0).attr("role", "img")
    .attr("aria-label", (drawn) => `${drawn.note.shortText}. ${drawn.note.longText}`)
    .on("focus", showFocusedTooltip)
    .on("blur", tooltipHandlers.hideTooltip);
}
