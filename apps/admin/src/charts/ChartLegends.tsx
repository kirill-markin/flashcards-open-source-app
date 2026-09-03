import type { JSX } from "react";
import { reviewEventPlatforms } from "../adminApi";
import {
  getPlatformColor,
  platformLabels,
  uniqueUserCohortColors,
  uniqueUserCohortKeys,
  uniqueUserCohortLabels,
} from "./chartPrimitives";

export function PlatformKey(): JSX.Element {
  return (
    <div className="platform-key" aria-label="Platform color key">
      {reviewEventPlatforms.map((platform) => (
        <span key={platform} className="platform-key-item">
          <span className="platform-key-swatch" style={{ backgroundColor: getPlatformColor(platform) }} />
          <span>{platformLabels[platform]}</span>
        </span>
      ))}
    </div>
  );
}

export function UniqueUserCohortKey(): JSX.Element {
  return (
    <div className="platform-key" aria-label="Unique users cohort color key">
      {uniqueUserCohortKeys.map((cohort) => (
        <span key={cohort} className="platform-key-item">
          <span className="platform-key-swatch" style={{ backgroundColor: uniqueUserCohortColors[cohort] }} />
          <span>{uniqueUserCohortLabels[cohort]}</span>
        </span>
      ))}
    </div>
  );
}
