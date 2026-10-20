import type { JSX } from "react";
import type { FunnelReportProps } from "../funnels/funnelSections";
import { FirstLaunchFunnelBreakdownSection, firstLaunchFunnelBreakdowns } from "./FirstLaunchFunnelBreakdownSection";
import { FirstLaunchFunnelSection } from "./FirstLaunchFunnelSection";

/** The First launch card without its Details button, then one breakdown card per dimension, in the Level 1 grid. */
export function FirstLaunchFunnelDetailsPage(props: FunnelReportProps): JSX.Element {
  return (
    <div className="level-1-metrics-grid">
      <FirstLaunchFunnelSection
        config={props.config}
        filters={props.filters}
        isRangeLoading={props.isRangeLoading}
        onTerminalAdminError={props.onTerminalAdminError}
        onDetailsNavigate={null}
      />
      {firstLaunchFunnelBreakdowns.map((breakdown) => (
        <FirstLaunchFunnelBreakdownSection
          key={breakdown.dimension.id}
          config={props.config}
          filters={props.filters}
          isRangeLoading={props.isRangeLoading}
          onTerminalAdminError={props.onTerminalAdminError}
          breakdown={breakdown}
        />
      ))}
    </div>
  );
}
