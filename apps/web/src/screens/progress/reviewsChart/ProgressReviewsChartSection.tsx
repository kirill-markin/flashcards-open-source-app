import type { ReactElement } from "react";
import type { ChartPage } from "./progressReviewsChartModel";

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
  navigation: ProgressReviewsChartNavigationState | null;
  onSelectPageStartLocalDate: (pageStartLocalDate: string | null) => void;
}>;

function ProgressReviewsChartColumn(props: Readonly<{
  day: ChartPage["days"][number];
}>): ReactElement {
  const { day } = props;
  const columnClassName = [
    "progress-chart-column",
    day.isToday && day.reviewCount === 0 ? "progress-chart-column-today" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");
  const barClassName = [
    "progress-chart-bar",
    day.reviewCount > 0 ? "progress-chart-bar-active" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");

  return (
    <div
      className={columnClassName}
      title={day.title}
    >
      <div className="progress-chart-bar-shell">
        <span
          className={barClassName}
          style={{
            height: `${day.barHeightPercentage}%`,
          }}
          aria-hidden="true"
          data-testid={`progress-chart-bar-${day.date}`}
        />
      </div>
      <div className="progress-chart-labels" aria-hidden="true">
        <span className="progress-chart-month">
          {day.showMonthLabel ? day.monthLabel : ""}
        </span>
        <span className="progress-chart-day">{day.dayLabel}</span>
        <span className="progress-chart-weekday">{day.weekdayLabel}</span>
      </div>
    </div>
  );
}

export function ProgressReviewsChartSection(props: ProgressReviewsChartSectionProps): ReactElement {
  const {
    title,
    pageRangeLabel,
    visiblePage,
    chartGuideLabels,
    navigation,
    onSelectPageStartLocalDate,
  } = props;

  return (
    <section className="content-card progress-section">
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
              onClick={() => onSelectPageStartLocalDate(navigation.previousPageStartLocalDate)}
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
              onClick={() => onSelectPageStartLocalDate(navigation.nextPageStartLocalDate)}
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
                <ProgressReviewsChartColumn key={day.date} day={day} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
