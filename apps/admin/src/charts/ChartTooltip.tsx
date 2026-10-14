import { useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import type { ChartTooltipHandlers, ChartTooltipState } from "./chartPrimitives";

export type ChartTooltipController = Readonly<{
  tooltipState: ChartTooltipState;
  tooltipHandlers: ChartTooltipHandlers;
}>;

export function useChartTooltip(): ChartTooltipController {
  const [tooltipState, setTooltipState] = useState<ChartTooltipState>({
    visible: false,
    html: "",
    left: 0,
    top: 0,
  });
  const tooltipHandlers = useMemo<ChartTooltipHandlers>(() => ({
    showTooltip: (html: string, clientX: number, clientY: number): void => {
      setTooltipState({
        visible: true,
        html,
        left: clientX + 18,
        top: clientY + 18,
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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: props.left, top: props.top });
  useLayoutEffect(() => {
    if (!props.visible || tooltipRef.current === null) return;
    const tooltip = tooltipRef.current;
    const positionTooltip = (): void => {
      const padding = 18;
      setPosition({
        left: Math.max(padding, Math.min(window.innerWidth - tooltip.offsetWidth - padding, props.left)),
        top: Math.max(padding, Math.min(window.innerHeight - tooltip.offsetHeight - padding, props.top)),
      });
    };
    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    return () => window.removeEventListener("resize", positionTooltip);
  }, [props.visible, props.html, props.left, props.top]);

  return (
    <div
      ref={tooltipRef}
      className={`tooltip${props.visible ? " visible" : ""}`}
      style={{ left: position.left, top: position.top }}
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  );
}
