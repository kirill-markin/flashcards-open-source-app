import { catalogInstallConversionWindowDays } from "../catalogInstallFunnel/query";
import { formatFunnelRangeNote, type FunnelRangeKey } from "./funnelRangeReports";

/**
 * A caveat a funnel card shows as a `⚠` beside its title; `id` and `label`, which names its button,
 * are each unique among the card's warnings.
 */
export type FunnelWarning = Readonly<{ id: string; label: string; text: string }>;

type FunnelWarningRange = Readonly<{ key: FunnelRangeKey; seriesLabel: string | null }>;

/**
 * One range's notes, keyed by kind with `null` for a note the range does not trigger, as warnings
 * named by the range's series and identified by range and kind; the label leaves the range out while
 * the card shows only one.
 */
export function buildFunnelRangeWarnings(
  range: FunnelWarningRange,
  notes: Readonly<Record<string, string | null>>,
): ReadonlyArray<FunnelWarning> {
  return Object.entries(notes).flatMap(([kind, note]) => {
    if (note === null) {
      return [];
    }

    const kindLabel = kind.replaceAll("-", " ");
    return [{
      id: `${range.key}-${kind}`,
      label: range.seriesLabel === null ? kindLabel : `${range.key.toUpperCase()} range ${kindLabel}`,
      text: formatFunnelRangeNote(range.seriesLabel, note),
    }];
  });
}

/** Says how many of one range's people can still move down the funnel, or `null` when none can. */
export function buildFunnelMaturingNote(maturingCount: number, entryCount: number): string | null {
  return maturingCount === 0
    ? null
    : `${maturingCount.toLocaleString("en-US")} of ${entryCount.toLocaleString("en-US")} people entered less than ${catalogInstallConversionWindowDays} days ago; later steps for them are still filling in.`;
}

/**
 * Names a compared range nobody entered while another still draws; a card where every range is
 * empty shows its own empty chart instead, and a single range never needs this.
 */
export function buildFunnelEmptyRangeNote(
  ranges: ReadonlyArray<Readonly<{ hasEntries: boolean }>>,
  range: Readonly<{ seriesLabel: string | null; hasEntries: boolean }>,
): string | null {
  return range.seriesLabel === null || range.hasEntries || ranges.every((other) => other.hasEntries === false)
    ? null
    : "nobody entered this funnel in this range with these filters, so its bars are empty.";
}
