import type { JSX, ReactNode } from "react";

/** A ready chart's `<svg>` with an optional note centered over it, so the note adds no height. */
export function ChartAreaWithNote(
  props: Readonly<{
    viewBoxWidth: number;
    viewBoxHeight: number;
    note: string | null;
    children: ReactNode;
  }>,
): JSX.Element {
  return (
    <div className="chart-area" style={{ aspectRatio: `${props.viewBoxWidth} / ${props.viewBoxHeight}` }}>
      {props.children}
      {props.note === null ? null : <p className="chart-area-note"><span>{props.note}</span></p>}
    </div>
  );
}
