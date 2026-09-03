import { useMemo, useState, type JSX } from "react";
import type { ChartTooltipHandlers, ChartTooltipState } from "./chartPrimitives";

export type ChartTooltipController = Readonly<{
  tooltipState: ChartTooltipState;
  tooltipHandlers: ChartTooltipHandlers;
}>;

/** Tooltip state for one chart column. The handlers are stable so a chart effect can depend on them. */
export function useChartTooltip(): ChartTooltipController {
  const [tooltipState, setTooltipState] = useState<ChartTooltipState>({
    visible: false,
    html: "",
    left: 0,
    top: 0,
  });
  const tooltipHandlers = useMemo<ChartTooltipHandlers>(() => ({
    showTooltip: (html: string, clientX: number, clientY: number): void => {
      const padding = 18;
      const nextLeft = Math.max(padding, Math.min(window.innerWidth - 340, clientX + 18));
      const nextTop = Math.max(padding, Math.min(window.innerHeight - 220, clientY + 18));
      setTooltipState({
        visible: true,
        html,
        left: nextLeft,
        top: nextTop,
      });
    },
    hideTooltip: (): void => {
      setTooltipState((currentState) => ({
        ...currentState,
        visible: false,
      }));
    },
  }), []);

  return { tooltipState, tooltipHandlers };
}

export function ChartTooltip(props: ChartTooltipState): JSX.Element {
  return (
    <div
      className={`tooltip${props.visible ? " visible" : ""}`}
      style={{ left: props.left, top: props.top }}
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  );
}
