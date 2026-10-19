import type { JSX } from "react";
import { formatGeneratedAt } from "./formatting";

/** At least as wide as any `formatGeneratedAt` output: widest month letters, two-digit hour, wider meridiem. */
const reservedGeneratedAt = "MMM 00, 0000, 00:00 AM UTC";

/**
 * A chart header's Generated slot, kept in every load state so the header never changes height.
 * `null` reserves the slot invisibly before the first report lands.
 */
export function ChartGeneratedAt(props: Readonly<{ generatedAtUtc: string | null }>): JSX.Element {
  return props.generatedAtUtc === null
    ? <span className="chart-generated-at-placeholder" aria-hidden="true">Generated {reservedGeneratedAt}</span>
    : <span>Generated {formatGeneratedAt(props.generatedAtUtc)}</span>;
}
