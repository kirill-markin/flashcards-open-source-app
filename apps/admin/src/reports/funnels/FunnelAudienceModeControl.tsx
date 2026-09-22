import type { JSX } from "react";
import {
  funnelAudienceModeExplanations,
  funnelAudienceModeLabels,
  funnelAudienceModes,
  type AnalyticsFilterState,
  type FunnelAudienceMode,
} from "../../filters/analyticsFilters";

/**
 * The one control that decides who all four funnels count, as a segmented control above them.
 *
 * It is not in the shared filter bar, and that is deliberate: every field there is a multi-select
 * whose empty state means something, while this is one choice out of three that always has an answer.
 * It also changes what a person is rather than which people are kept, so it belongs next to the
 * funnels it redefines rather than among the predicates that narrow them.
 *
 * The modes are offered widest first, so moving right always narrows the audience, and the selected
 * one explains itself underneath rather than in a tooltip, because a reader comparing two numbers
 * needs to know which people each of them counted without hovering anything.
 */
export function FunnelAudienceModeControl(
  props: Readonly<{
    filters: AnalyticsFilterState;
    isReportLoading: boolean;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
  }>,
): JSX.Element {
  const selectedMode = props.filters.funnelAudienceMode;
  const selectMode = (mode: FunnelAudienceMode): void => {
    if (mode === selectedMode) {
      return;
    }

    props.onFiltersChange({ ...props.filters, funnelAudienceMode: mode });
  };

  return (
    <section className="funnel-audience-control" aria-labelledby="funnel-audience-title">
      <div className="funnel-audience-header">
        <h3 id="funnel-audience-title">Who the funnels count</h3>
        <div className="funnel-audience-modes" role="group" aria-labelledby="funnel-audience-title">
          {funnelAudienceModes.map((mode) => (
            <button
              key={mode}
              className={mode === selectedMode
                ? "filter-button filter-button-compact funnel-audience-mode-selected"
                : "filter-button filter-button-compact"}
              type="button"
              data-testid={`funnel-audience-${mode}`}
              aria-pressed={mode === selectedMode}
              disabled={props.isReportLoading}
              onClick={() => selectMode(mode)}
            >
              {funnelAudienceModeLabels[mode]}
            </button>
          ))}
        </div>
      </div>
      <p className="funnel-audience-explanation" aria-live="polite">
        {funnelAudienceModeExplanations[selectedMode]}
      </p>
    </section>
  );
}
