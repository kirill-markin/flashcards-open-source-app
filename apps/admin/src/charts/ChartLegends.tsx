import type { JSX } from "react";
import { productEventDeviceTypes, productEventOsNames, reviewEventPlatforms } from "../adminApi";
import {
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

function ChartColorKey<Key extends string>(
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
