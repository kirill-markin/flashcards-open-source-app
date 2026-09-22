import type { JSX } from "react";
import { catalogInstallConversionWindowDays } from "../catalogInstallFunnel/query";

/** Says how many of the funnel's people can still move down it, or nothing when none can. */
export function FunnelMaturingWarning(
  props: Readonly<{ maturingCount: number; entryCount: number }>,
): JSX.Element | null {
  if (props.maturingCount === 0) {
    return null;
  }

  return (
    <p className="report-state report-state-warning" aria-live="polite">
      {props.maturingCount.toLocaleString("en-US")} of {props.entryCount.toLocaleString("en-US")} people entered less than {catalogInstallConversionWindowDays} days ago; later steps for them are still filling in.
    </p>
  );
}
