import type { JSX } from "react";
import type { FunnelRangeKey } from "./funnelRangeReports";

/**
 * Names each compared range nobody entered while the other still draws; a card where every range is
 * empty shows its own empty chart instead.
 */
export function FunnelEmptyRangeNotes(
  props: Readonly<{
    ranges: ReadonlyArray<Readonly<{ key: FunnelRangeKey; seriesLabel: string | null; hasEntries: boolean }>>;
  }>,
): JSX.Element | null {
  if (props.ranges.every((range) => range.hasEntries === false)) {
    return null;
  }

  return (
    <>
      {props.ranges.map((range) => (range.seriesLabel === null || range.hasEntries ? null : (
        <p key={range.key} className="report-state" aria-live="polite">
          {range.seriesLabel}: nobody entered this funnel in this range with these filters, so its bars are empty.
        </p>
      )))}
    </>
  );
}
