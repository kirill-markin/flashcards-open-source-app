import type { JSX } from "react";
import { productEventDeviceTypes, productEventOsNames, reviewEventPlatforms } from "../adminApi";
import {
  dailyActiveUsersUniqueTotalMarkerColor,
  deviceTypeColors,
  deviceTypeLabels,
  getPlatformColor,
  osNameColors,
  osNameLabels,
  platformLabels,
  uniqueUserCohortColors,
  uniqueUserCohortKeys,
  uniqueUserCohortLabels,
} from "./chartPrimitives";

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

export function PlatformKey(): JSX.Element {
  return (
    <ChartColorKey
      ariaLabel="Platform color key"
      keys={reviewEventPlatforms}
      getColor={getPlatformColor}
      getLabel={(platform) => platformLabels[platform]}
    />
  );
}

export function OsNameKey(): JSX.Element {
  return (
    <ChartColorKey
      ariaLabel="OS name color key"
      keys={productEventOsNames}
      getColor={(osName) => osNameColors[osName]}
      getLabel={(osName) => osNameLabels[osName]}
    />
  );
}

export function DeviceTypeKey(): JSX.Element {
  return (
    <ChartColorKey
      ariaLabel="Device type color key"
      keys={productEventDeviceTypes}
      getColor={(deviceType) => deviceTypeColors[deviceType]}
      getLabel={(deviceType) => deviceTypeLabels[deviceType]}
    />
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

/** The key of the line `renderDailyActiveUsersOverlappingStackChart` draws, shaped like that line. */
export function UniqueActiveUsersMarkerKey(): JSX.Element {
  return (
    <div className="platform-key" aria-label="Unique active users marker key">
      <span className="platform-key-item">
        <span
          className="platform-key-swatch"
          style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: dailyActiveUsersUniqueTotalMarkerColor }}
        />
        <span>Unique active users</span>
      </span>
    </div>
  );
}
