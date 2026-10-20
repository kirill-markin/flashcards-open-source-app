import type { JSX } from "react";
import { uniqueUserCohortColors, uniqueUserCohortKeys, uniqueUserCohortLabels } from "./chartPrimitives";

export function ChartColorKey<Key extends string>(
  props: Readonly<{
    ariaLabel: string;
    keys: ReadonlyArray<Key>;
    getColor: (key: Key) => string;
    getLabel: (key: Key) => string;
  }>,
): JSX.Element {
  return (
    <div className="platform-key" aria-label={props.ariaLabel}>
      {props.keys.map((key) => (
        <span key={key} className="platform-key-item">
          <span className="platform-key-swatch" style={{ backgroundColor: props.getColor(key) }} />
          <span>{props.getLabel(key)}</span>
        </span>
      ))}
    </div>
  );
}

/** An invisible one-chip key that holds a data-derived key's row height until its keys load. */
export function ChartColorKeyPlaceholder(): JSX.Element {
  return (
    <div className="platform-key platform-key-placeholder" aria-hidden="true">
      <span className="platform-key-item">
        <span className="platform-key-swatch" />
        <span>{"\u00a0"}</span>
      </span>
    </div>
  );
}

export function UniqueUserCohortKey(): JSX.Element {
  return (
    <ChartColorKey
      ariaLabel="Unique users cohort color key"
      keys={uniqueUserCohortKeys}
      getColor={(cohort) => uniqueUserCohortColors[cohort]}
      getLabel={(cohort) => uniqueUserCohortLabels[cohort]}
    />
  );
}
