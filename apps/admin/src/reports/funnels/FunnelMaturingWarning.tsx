import type { JSX } from "react";
import { catalogInstallConversionWindowDays } from "../catalogInstallFunnel/query";
import { formatFunnelRangeNote } from "./funnelRangeReports";

/** Says how many of one range's people can still move down the funnel, or nothing when none can. */
export function FunnelMaturingWarning(
  props: Readonly<{ seriesLabel: string | null; maturingCount: number; entryCount: number }>,
): JSX.Element | null {
  if (props.maturingCount === 0) {
    return null;
  }

  return (
    <p className="report-state report-state-warning" aria-live="polite">
      {formatFunnelRangeNote(
        props.seriesLabel,
        `${props.maturingCount.toLocaleString("en-US")} of ${props.entryCount.toLocaleString("en-US")} people entered less than ${catalogInstallConversionWindowDays} days ago; later steps for them are still filling in.`,
      )}
    </p>
  );
}
