import type { ReactElement } from "react";
import type { ProgressReviewScheduleBucketKey } from "../../../types";
import type {
  ReviewScheduleBucketView,
  ReviewScheduleDonutSegment,
} from "./progressReviewScheduleModel";

type ProgressReviewScheduleSectionProps = Readonly<{
  title: string;
  totalCardsLabel: string;
  legendLabel: string;
  selectedBucket: ProgressReviewScheduleBucketKey | null;
  bucketViews: ReadonlyArray<ReviewScheduleBucketView>;
  donutSegments: ReadonlyArray<ReviewScheduleDonutSegment>;
  onSelectBucket: (bucketKey: ProgressReviewScheduleBucketKey) => void;
  onClearSelection: () => void;
}>;

export function ProgressReviewScheduleSection(props: ProgressReviewScheduleSectionProps): ReactElement {
  const {
    title,
    totalCardsLabel,
    legendLabel,
    selectedBucket,
    bucketViews,
    donutSegments,
    onSelectBucket,
    onClearSelection,
  } = props;
  const reviewScheduleHasSelection = selectedBucket !== null;

  return (
    <section
      className="content-card progress-section"
      data-testid="progress-review-schedule-card"
      onClick={onClearSelection}
    >
      <div className="progress-section-head">
        <div className="progress-chart-heading">
          <h2 className="progress-section-title">{title}</h2>
          <p className="progress-chart-range">
            {totalCardsLabel}
          </p>
        </div>
      </div>

      <div className="progress-review-schedule">
        {donutSegments.length > 0 ? (
          <svg
            className="progress-review-schedule-donut"
            viewBox="-110 -110 220 220"
            role="img"
            aria-label={title}
          >
            {donutSegments.map((segment) => {
              const isSelected = selectedBucket === segment.key;
              const segmentClassName = !reviewScheduleHasSelection
                ? "progress-donut-segment"
                : isSelected
                  ? "progress-donut-segment is-selected"
                  : "progress-donut-segment is-dimmed";
              return (
                <path
                  key={segment.key}
                  d={segment.pathD}
                  fill={segment.color}
                  className={segmentClassName}
                  data-testid={`progress-review-schedule-segment-${segment.key}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectBucket(segment.key);
                  }}
                />
              );
            })}
          </svg>
        ) : (
          <div className="progress-review-schedule-donut progress-review-schedule-donut-empty" aria-hidden="true" />
        )}

        <ul
          className="progress-review-schedule-list"
          aria-label={legendLabel}
        >
          {bucketViews.map((bucket) => {
            const isSelected = selectedBucket === bucket.key;
            const isInteractive = bucket.count > 0;
            const rowClassName = !reviewScheduleHasSelection
              ? "progress-review-schedule-row"
              : isSelected
                ? "progress-review-schedule-row is-selected"
                : "progress-review-schedule-row is-dimmed";
            return (
              <li
                key={bucket.key}
                className={rowClassName}
                data-testid={`progress-review-schedule-bucket-${bucket.key}`}
              >
                <button
                  type="button"
                  className="progress-review-schedule-row-button"
                  disabled={!isInteractive}
                  aria-pressed={isInteractive ? isSelected : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectBucket(bucket.key);
                  }}
                >
                  <span
                    className="progress-review-schedule-swatch"
                    style={{ backgroundColor: bucket.color }}
                    aria-hidden="true"
                  />
                  <span className="progress-review-schedule-label">{bucket.label}</span>
                  <span className="progress-review-schedule-values">
                    <span className="progress-review-schedule-count">{bucket.countLabel}</span>
                    <span className="progress-review-schedule-percent">{bucket.percentageLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
