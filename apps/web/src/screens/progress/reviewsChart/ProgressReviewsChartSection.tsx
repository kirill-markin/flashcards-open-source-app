import type { ReactElement } from "react";
import type {
  ChartPage,
  ChartRatingLegendItem,
  ProgressReviewsChartRatingKey,
  ProgressReviewsChartSelection,
} from "./progressReviewsChartModel";

export type ProgressReviewsChartNavigationState = Readonly<{
  previousPageStartLocalDate: string | null;
  nextPageStartLocalDate: string | null;
  previousWeekLabel: string;
  nextWeekLabel: string;
  previousWeekArrow: string;
  nextWeekArrow: string;
}>;

type ProgressReviewsChartSectionProps = Readonly<{
  title: string;
  pageRangeLabel: string;
  visiblePage: ChartPage | null;
  chartGuideLabels: ReadonlyArray<string>;
  legendLabel: string;
  ratingLegendItems: ReadonlyArray<ChartRatingLegendItem>;
  selection: ProgressReviewsChartSelection;
  navigation: ProgressReviewsChartNavigationState | null;
  onSelectPageStartLocalDate: (pageStartLocalDate: string | null) => void;
  onSelectDay: (date: string) => void;
  onSelectRating: (ratingKey: ProgressReviewsChartRatingKey) => void;
  onClearSelection: () => void;
}>;

function ProgressReviewsChartColumn(props: Readonly<{
  day: ChartPage["days"][number];
  selection: ProgressReviewsChartSelection;
  onSelectDay: (date: string) => void;
}>): ReactElement {
  const { day, selection, onSelectDay } = props;
  const hasSelectedDay = selection.kind === "day";
  const isSelectedDay = selection.kind === "day" && selection.date === day.date;
  const isDimmed = hasSelectedDay && isSelectedDay === false;
  const columnClassName = [
    "progress-chart-column",
    day.isToday && day.reviewCount === 0 ? "progress-chart-column-today" : "",
    isSelectedDay ? "is-selected" : "",
    isDimmed ? "is-dimmed" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");
  const barClassName = [
    "progress-chart-bar",
    day.displayReviewCount > 0 ? "progress-chart-bar-active" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");

  return (
    <div
      className={columnClassName}
      title={day.title}
    >
      <button
        type="button"
        className="progress-chart-column-button"
        aria-label={day.title}
        aria-pressed={isSelectedDay}
        onClick={(event) => {
          event.stopPropagation();
          onSelectDay(day.date);
        }}
      >
        <div className="progress-chart-bar-shell">
          <span
            className={barClassName}
            style={{
              height: `${day.barHeightPercentage}%`,
            }}
            aria-hidden="true"
            data-testid={`progress-chart-bar-${day.date}`}
          >
            {day.segments.map((segment) => (
              <span
                key={`${day.date}-${segment.ratingKey}`}
                className="progress-chart-bar-segment"
                style={{
                  backgroundColor: isDimmed ? "#7A8088" : segment.color,
                  height: `${segment.heightPercentage}%`,
                }}
                data-testid={`progress-chart-segment-${day.date}-${segment.ratingKey}`}
              />
            ))}
          </span>
        </div>
        <div className="progress-chart-labels" aria-hidden="true">
          <span className="progress-chart-month">
            {day.showMonthLabel ? day.monthLabel : ""}
          </span>
          <span className="progress-chart-day">{day.dayLabel}</span>
          <span className="progress-chart-weekday">{day.weekdayLabel}</span>
        </div>
      </button>
    </div>
  );
}

function ProgressReviewsRatingLegend(props: Readonly<{
  legendLabel: string;
  items: ReadonlyArray<ChartRatingLegendItem>;
  onSelectRating: (ratingKey: ProgressReviewsChartRatingKey) => void;
}>): ReactElement {
  const {
    legendLabel,
    items,
    onSelectRating,
  } = props;

  return (
    <ul className="progress-chart-rating-list" aria-label={legendLabel}>
      {items.map((item) => {
        const rowClassName = [
          "progress-chart-rating-row",
          item.isSelected ? "is-selected" : "",
          item.isDimmed ? "is-dimmed" : "",
        ]
          .filter((className) => className !== "")
          .join(" ");
        return (
          <li key={item.ratingKey} className={rowClassName}>
            <button
              type="button"
              className="progress-chart-rating-row-button"
              disabled={item.isDisabled}
              aria-pressed={item.isDisabled ? undefined : item.isSelected}
              data-testid={`progress-chart-rating-${item.ratingKey}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectRating(item.ratingKey);
              }}
            >
              <span
                className="progress-chart-rating-swatch"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className="progress-chart-rating-label">{item.label}</span>
              <span className="progress-chart-rating-value">{item.valueLabel}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProgressReviewsChartSection(props: ProgressReviewsChartSectionProps): ReactElement {
  const {
    title,
    pageRangeLabel,
    visiblePage,
    chartGuideLabels,
    legendLabel,
    ratingLegendItems,
    selection,
    navigation,
    onSelectPageStartLocalDate,
    onSelectDay,
    onSelectRating,
    onClearSelection,
  } = props;

  return (
    <section className="content-card progress-section" onClick={onClearSelection}>
      <div className="progress-section-head">
        <div className="progress-chart-heading">
          <h2 className="progress-section-title">{title}</h2>
          {visiblePage !== null ? (
            <p className="progress-chart-range" data-testid="progress-chart-range">
              {pageRangeLabel}
            </p>
          ) : null}
        </div>

        {navigation === null ? null : (
          <div className="progress-chart-nav">
            <button
              type="button"
              className="ghost-btn progress-chart-nav-btn"
              onClick={(event) => {
                event.stopPropagation();
                onSelectPageStartLocalDate(navigation.previousPageStartLocalDate);
              }}
              disabled={navigation.previousPageStartLocalDate === null}
              aria-label={navigation.previousWeekLabel}
              data-testid="progress-chart-previous-week"
            >
              <span className="progress-chart-nav-icon" aria-hidden="true">
                {navigation.previousWeekArrow}
              </span>
            </button>
            <button
              type="button"
              className="ghost-btn progress-chart-nav-btn"
              onClick={(event) => {
                event.stopPropagation();
                onSelectPageStartLocalDate(navigation.nextPageStartLocalDate);
              }}
              disabled={navigation.nextPageStartLocalDate === null}
              aria-label={navigation.nextWeekLabel}
              data-testid="progress-chart-next-week"
            >
              <span className="progress-chart-nav-icon" aria-hidden="true">
                {navigation.nextWeekArrow}
              </span>
            </button>
          </div>
        )}
      </div>

      {visiblePage !== null && (
        <div className="progress-chart-shell">
          <div className="progress-chart-y-axis" aria-hidden="true">
            {chartGuideLabels.map((label, index) => (
              <span
                key={`progress-guide-label-${index}`}
                className="progress-chart-y-label"
                data-testid={index === 0 ? "progress-chart-y-label-max" : undefined}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="progress-chart-plot">
            <div className="progress-chart-guides" aria-hidden="true">
              {chartGuideLabels.map((_, index) => (
                <span key={`progress-guide-line-${index}`} className="progress-chart-guide-line" />
              ))}
            </div>

            <div className="progress-chart-columns">
              {visiblePage.days.map((day) => (
                <ProgressReviewsChartColumn
                  key={day.date}
                  day={day}
                  selection={selection}
                  onSelectDay={onSelectDay}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {visiblePage !== null ? (
        <ProgressReviewsRatingLegend
          legendLabel={legendLabel}
          items={ratingLegendItems}
          onSelectRating={onSelectRating}
        />
      ) : null}
    </section>
  );
}
