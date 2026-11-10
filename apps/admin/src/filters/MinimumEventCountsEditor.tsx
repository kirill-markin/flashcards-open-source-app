import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  analyticsThresholdEventTypeLabels,
  analyticsThresholdEventTypes,
  parseAcceptedMinimumCount,
  type AnalyticsMinimumEventCount,
  type AnalyticsThresholdEventType,
} from "./analyticsFilters";
import { FilterFieldResetButton } from "./FilterFieldResetButton";

type MinimumEventCountsEditorProps = Readonly<{
  minimumEventCounts: ReadonlyArray<AnalyticsMinimumEventCount>;
  /** Whether the selection was accepted. */
  onMinimumEventCountsChange: (minimumEventCounts: ReadonlyArray<AnalyticsMinimumEventCount>) => boolean;
}>;

// One threshold per event type, so setting one replaces the entry that event type already had, and
// the result comes back in the declared order.
function withMinimumEventCount(
  entries: ReadonlyArray<AnalyticsMinimumEventCount>,
  eventType: AnalyticsThresholdEventType,
  minimumCount: number,
): ReadonlyArray<AnalyticsMinimumEventCount> {
  return analyticsThresholdEventTypes.flatMap((option): ReadonlyArray<AnalyticsMinimumEventCount> => {
    if (option === eventType) {
      return [{ eventType, minimumCount }];
    }

    return entries.filter((entry) => entry.eventType === option);
  });
}

// The threshold popover's content. It is mounted only while that popover is open, so closing the
// popover ends every draft at once: the input a draft was typed in is gone, so there is nothing left
// for the text to be finished in.
export function MinimumEventCountsEditor(props: MinimumEventCountsEditorProps): JSX.Element {
  // The raw text of a threshold input that the filter cannot hold: "1." on the way to "1.5", a lone
  // "-", a pasted "1 000". It has to stay visible to be finished or corrected, and it must not reach
  // the selection, so it lives here and nowhere else. Only rejected text is ever drafted, which is
  // what makes an input with no draft a reading of the count that is actually applied.
  const [minimumCountDrafts, setMinimumCountDrafts] = useState<
    ReadonlyMap<AnalyticsThresholdEventType, string>
  >(() => new Map());
  const minimumCountByEventType = useMemo(
    () => new Map<AnalyticsThresholdEventType, number>(
      props.minimumEventCounts.map((entry) => [entry.eventType, entry.minimumCount]),
    ),
    [props.minimumEventCounts],
  );
  const previousMinimumCountByEventTypeRef = useRef<
    ReadonlyMap<AnalyticsThresholdEventType, number>
  >(minimumCountByEventType);

  // The other thing that ends a draft is the committed count under it changing, which covers
  // `Reset all`, `Clear every threshold` and the user's own accepted keystroke. It ends the draft on
  // that event type alone: an accepted count typed into one input must not erase text still being
  // edited in another, untouched one. The previous counts are held in a ref because
  // `props.minimumEventCounts` can arrive as a fresh array on every commit, so only its contents can
  // tell a real change from a repeat.
  useEffect(() => {
    const previousMinimumCountByEventType = previousMinimumCountByEventTypeRef.current;
    previousMinimumCountByEventTypeRef.current = minimumCountByEventType;

    const changedEventTypes = analyticsThresholdEventTypes.filter((eventType) => (
      previousMinimumCountByEventType.get(eventType) !== minimumCountByEventType.get(eventType)
    ));
    if (changedEventTypes.length === 0) {
      return;
    }

    setMinimumCountDrafts((drafts) => {
      const remainingDrafts = new Map(drafts);
      for (const eventType of changedEventTypes) {
        remainingDrafts.delete(eventType);
      }

      return remainingDrafts.size === drafts.size ? drafts : remainingDrafts;
    });
  }, [minimumCountByEventType]);

  function clearMinimumCountDraft(eventType: AnalyticsThresholdEventType): void {
    setMinimumCountDrafts((drafts) => {
      if (drafts.has(eventType) === false) {
        return drafts;
      }

      const remainingDrafts = new Map(drafts);
      remainingDrafts.delete(eventType);
      return remainingDrafts;
    });
  }

  // An empty input is no threshold on that event type, which is how this input clears one;
  // `Clear every threshold` and `Reset all` clear them too. Text that does not name a whole count of
  // at least one is not a threshold this filter can hold: it is kept as a draft and named as not
  // applied, so the selection it failed to change stays exactly what the other inputs and the popover
  // header say it is, rather than being silently dropped or reread into a different one. A keystroke
  // that lands on the count already applied commits nothing, because every commit repaints the bar as
  // `Updating` and refetches every report in the area.
  function handleMinimumEventCountChange(
    eventType: AnalyticsThresholdEventType,
    rawMinimumCount: string,
  ): void {
    const committedMinimumCount = minimumCountByEventType.get(eventType);

    if (rawMinimumCount.trim() === "") {
      clearMinimumCountDraft(eventType);
      if (committedMinimumCount === undefined) {
        return;
      }

      props.onMinimumEventCountsChange(props.minimumEventCounts.filter(
        (entry) => entry.eventType !== eventType,
      ));
      return;
    }

    const minimumCount = parseAcceptedMinimumCount(rawMinimumCount);
    if (minimumCount === undefined) {
      setMinimumCountDrafts((drafts) => new Map(drafts).set(eventType, rawMinimumCount));
      return;
    }

    clearMinimumCountDraft(eventType);
    if (minimumCount === committedMinimumCount) {
      return;
    }

    props.onMinimumEventCountsChange(withMinimumEventCount(
      props.minimumEventCounts,
      eventType,
      minimumCount,
    ));
  }

  // Named rather than only marked on the input, because a rejected count stays where it was typed
  // while the popover header keeps showing the selection it failed to change.
  const rejectedMinimumCountLabels = analyticsThresholdEventTypes
    .filter((eventType) => minimumCountDrafts.has(eventType))
    .map((eventType) => analyticsThresholdEventTypeLabels[eventType]);

  return (
    <>
      <div className="filter-threshold-list">
        {analyticsThresholdEventTypes.map((eventType) => {
          const minimumCount = minimumCountByEventType.get(eventType);
          const draftMinimumCount = minimumCountDrafts.get(eventType);

          return (
            <label
              key={eventType}
              className={`filter-threshold-option${minimumCount === undefined ? "" : " selected"}`}
            >
              <span>{analyticsThresholdEventTypeLabels[eventType]}</span>
              {/*
                A text input rather than a number one: a number input hands the handler an empty
                string for anything it cannot parse yet, so typing a "." would read as "cleared"
                and drop a threshold that was already applied, while the field went on showing
                the text. Raw text keeps what was typed and what is applied two separate things.
              */}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Any"
                aria-invalid={draftMinimumCount !== undefined}
                value={draftMinimumCount ?? (minimumCount === undefined ? "" : String(minimumCount))}
                onChange={(event) => handleMinimumEventCountChange(
                  eventType,
                  event.currentTarget.value,
                )}
              />
            </label>
          );
        })}
      </div>
      {rejectedMinimumCountLabels.length === 0 ? null : (
        <p className="filter-error" role="alert">
          Not applied: {rejectedMinimumCountLabels.join(", ")}. A threshold has to be a whole
          number of at least 1.
        </p>
      )}
      {props.minimumEventCounts.length === 0 ? null : (
        <FilterFieldResetButton
          label="Clear every threshold"
          onReset={() => props.onMinimumEventCountsChange([])}
        />
      )}
    </>
  );
}
