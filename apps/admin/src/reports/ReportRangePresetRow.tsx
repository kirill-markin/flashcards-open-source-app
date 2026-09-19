import type { JSX } from "react";
import {
  buildPresetReportRange,
  reportRangePresetLabel,
  reportRangePresets,
} from "./reportValues";

// Every preset resolves against the available range, so a selected range is always applicable
// immediately and can never be the one that fails range validation.
export function ReportRangePresetRow(
  props: Readonly<{
    availableRange: Readonly<{ from: string; to: string }>;
    isDisabled: boolean;
    onPresetSelect: (range: Readonly<{ from: string; to: string }>) => void;
  }>,
): JSX.Element {
  return (
    <div className="range-preset-row" role="group" aria-label="Quick date ranges">
      {reportRangePresets.map((preset) => (
        <button
          key={preset.id}
          className="filter-button filter-button-compact"
          type="button"
          data-testid={`range-preset-${preset.id}`}
          disabled={props.isDisabled}
          onClick={() => props.onPresetSelect(
            buildPresetReportRange(preset, props.availableRange, reportRangePresetLabel),
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
