import type { JSX } from "react";

export function FilterFieldResetButton(
  props: Readonly<{
    label: string;
    onReset: () => void;
  }>,
): JSX.Element {
  return (
    <div className="filter-popover-actions">
      <button
        className="filter-button filter-button-compact"
        type="button"
        onClick={props.onReset}
      >
        {props.label}
      </button>
    </div>
  );
}
