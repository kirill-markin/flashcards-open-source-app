import type { JSX } from "react";
import {
  funnelGroupByNoneValue,
  type FunnelGroupByDimension,
} from "./funnelGroupBy";

/**
 * One funnel's `Group by` field, beside its chart heading.
 *
 * A NATIVE `<select>` ON PURPOSE, unlike either control it sits between. `FunnelAudienceModeControl`
 * is a segmented row because it has three fixed options that all have to be readable at once, and the
 * filter bar uses popovers because its fields are multi-selects whose empty state means something.
 * This is one choice out of up to eight, it has a default nobody needs to see, and it has to stay
 * narrow enough to sit on one line of its own above the chart, which is exactly what a `<select>` is.
 *
 * `None` is first and is the default, so the list reads as "off, or by one of these".
 *
 * IT IS MOUNTED BY THE SECTION RATHER THAN BY THE CHART, in every state the section can be in: a
 * funnel draws no chart while it loads and none at all when nothing matches the filters, and a field
 * that vanishes on its own use cannot be focused, watched, or set back to `None`.
 */
export function FunnelGroupByPicker(
  props: Readonly<{
    funnelId: string;
    /** The funnel's own dimensions, offered in declared order. */
    dimensions: ReadonlyArray<FunnelGroupByDimension>;
    selectedDimensionId: string | null;
    isReportLoading: boolean;
    /** The picked dimension, or `null` for the ungrouped default. */
    onSelect: (dimension: FunnelGroupByDimension | null) => void;
  }>,
): JSX.Element {
  const fieldId = `funnel-${props.funnelId}-group-by`;
  return (
    <div className="funnel-group-by">
      <label htmlFor={fieldId}>Group by</label>
      <select
        id={fieldId}
        className="funnel-group-by-select"
        data-testid={`funnel-group-by-${props.funnelId}`}
        value={props.selectedDimensionId ?? funnelGroupByNoneValue}
        // Busy, never disabled: disabling would take keyboard focus off the field on the very act of
        // using it, and picking again while the regrouped report is still in flight is safe, because
        // the section's load effect cancels the older one.
        aria-busy={props.isReportLoading}
        onChange={(event) => {
          const dimension = props.dimensions.find((candidate) => candidate.id === event.target.value);
          props.onSelect(dimension ?? null);
        }}
      >
        <option value={funnelGroupByNoneValue}>None</option>
        {props.dimensions.map((dimension) => (
          <option key={dimension.id} value={dimension.id}>{dimension.label}</option>
        ))}
      </select>
    </div>
  );
}
