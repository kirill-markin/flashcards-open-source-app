import type { JSX } from "react";
import { WarningTip } from "../../explanations/ExplanationTip";
import { findFunnelDetail, getFunnelDetailsPath } from "../../routing";
import { FunnelsLink } from "./FunnelsLink";
import type { FunnelWarning } from "./funnelWarnings";

const detailsButtonClassName = "filter-button filter-button-compact level-1-metric-details-link";

/**
 * A funnel card's heading row, styled like a Level 1 one, with a `⚠` after the title for each warning
 * the card's ranges trigger. Its Details button links to the funnel's Details page, stays disabled for
 * a funnel without one, and is absent on that page itself.
 */
export function FunnelSectionHeader(
  props: Readonly<{
    funnelId: string;
    title: string;
    warnings: ReadonlyArray<FunnelWarning>;
    onDetailsNavigate: ((path: string) => void) | null;
  }>,
): JSX.Element {
  const funnelDetail = findFunnelDetail(props.funnelId);
  const testId = `funnel-${props.funnelId}-details-button`;

  return (
    <header className="dashboard-section-header level-1-metric-section-header">
      <div className="explained-heading-row">
        <h2>{props.title}</h2>
        {props.warnings.map((warning) => (
          <WarningTip
            key={warning.id}
            label={`${props.title} data warning`}
            explanationId={`funnel-${props.funnelId}-${warning.id}-warning`}
          >{warning.text}</WarningTip>
        ))}
      </div>
      {props.onDetailsNavigate !== null && funnelDetail !== undefined ? (
        <FunnelsLink
          className={detailsButtonClassName}
          path={getFunnelDetailsPath(funnelDetail)}
          testId={testId}
          onNavigate={props.onDetailsNavigate}
        >Details</FunnelsLink>
      ) : null}
      {/* The hint sits on a wrapper, because some browsers show no tooltip for a disabled control. */}
      {props.onDetailsNavigate !== null && funnelDetail === undefined ? (
        <span title="Coming soon">
          <button className={detailsButtonClassName} type="button" data-testid={testId} disabled>Details</button>
        </span>
      ) : null}
    </header>
  );
}
