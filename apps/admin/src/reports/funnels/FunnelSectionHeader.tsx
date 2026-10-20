import type { JSX } from "react";

/** A funnel card's heading row, styled like a Level 1 one; its Details button stays disabled until the funnel has a Details page. */
export function FunnelSectionHeader(props: Readonly<{ funnelId: string; title: string }>): JSX.Element {
  return (
    <header className="dashboard-section-header level-1-metric-section-header">
      <h2>{props.title}</h2>
      {/* The hint sits on a wrapper, because some browsers show no tooltip for a disabled control. */}
      <span title="Coming soon">
        <button
          className="filter-button filter-button-compact level-1-metric-details-link"
          type="button"
          data-testid={`funnel-${props.funnelId}-details-button`}
          disabled
        >Details</button>
      </span>
    </header>
  );
}
