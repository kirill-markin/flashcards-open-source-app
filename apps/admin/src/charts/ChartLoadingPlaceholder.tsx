import type { JSX } from "react";

/** Stands in for a chart's `<svg>` inside its `.chart-scroll`, at the size that viewBox renders at. */
export function ChartLoadingPlaceholder(
  props: Readonly<{
    viewBoxWidth: number;
    viewBoxHeight: number;
    label: string;
  }>,
): JSX.Element {
  return (
    <div className="chart-area" style={{ aspectRatio: `${props.viewBoxWidth} / ${props.viewBoxHeight}` }}>
      <p className="chart-area-note" aria-live="polite"><span>{props.label}</span></p>
    </div>
  );
}
