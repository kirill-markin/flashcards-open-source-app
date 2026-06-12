import type { CSSProperties, ReactElement, Ref } from "react";
import { ReviewProgressBadgeIcon } from "../../shared/ReviewProgressBadgeIcon";
import type { StreakDay } from "./progressStreakModel";

const futureStreakDayStyle: Readonly<CSSProperties> = {
  borderStyle: "dashed",
  background: "transparent",
  opacity: 0.64,
};

const futureStreakMarkerStyle: Readonly<CSSProperties> = {
  background: "transparent",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
  color: "var(--text-tertiary)",
};

export type ProgressStreakSummaryView = Readonly<{
  label: string;
  status: string;
  hasReviewedToday: boolean;
  ariaLabel: string;
  formattedStreakValue: string;
}>;

type ProgressStreakSectionProps = Readonly<{
  title: string;
  sectionId: string;
  sectionRef: Ref<HTMLElement>;
  summary: ProgressStreakSummaryView | null;
  streakWeeks: ReadonlyArray<ReadonlyArray<StreakDay>>;
}>;

function ProgressStreakDay(props: Readonly<{
  day: StreakDay;
}>): ReactElement {
  const { day } = props;
  const dayClassName = [
    "progress-streak-day",
    day.reviewCount > 0 ? "progress-streak-day-complete" : "",
    day.isToday && day.reviewCount === 0 ? "progress-streak-day-today" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");

  return (
    <div
      className={dayClassName}
      title={day.title}
      data-streak-state={day.isFuture ? "future" : "active"}
      style={day.isFuture ? futureStreakDayStyle : undefined}
    >
      <span className="progress-streak-weekday">{day.weekdayLabel}</span>
      <span
        className="progress-streak-marker"
        aria-hidden="true"
        style={day.isFuture ? futureStreakMarkerStyle : undefined}
      >
        {day.reviewCount > 0 ? (
          <span className="progress-streak-marker-flame">
            <ReviewProgressBadgeIcon />
          </span>
        ) : day.isFuture ? null : (
          <span className="progress-streak-marker-day-value">{day.dayLabel}</span>
        )}
      </span>
    </div>
  );
}

function ProgressStreakSummary(props: Readonly<{
  summary: ProgressStreakSummaryView;
}>): ReactElement {
  const { summary } = props;

  return (
    <div className="progress-streak-summary">
      <div className="progress-streak-summary-copy">
        <span className="progress-streak-summary-label">{summary.label}</span>
        <p className="progress-streak-summary-status">{summary.status}</p>
      </div>
      <span
        className={`badge review-progress-badge progress-streak-summary-badge${summary.hasReviewedToday ? " review-progress-badge-active" : ""}`}
        aria-label={summary.ariaLabel}
        title={summary.ariaLabel}
      >
        <ReviewProgressBadgeIcon />
        <span className="review-progress-badge-value">
          {summary.formattedStreakValue}
        </span>
      </span>
    </div>
  );
}

export function ProgressStreakSection(props: ProgressStreakSectionProps): ReactElement {
  const { title, sectionId, sectionRef, summary, streakWeeks } = props;

  return (
    <section
      id={sectionId}
      ref={sectionRef}
      className="content-card progress-section"
      data-testid="progress-streak-card"
    >
      <div className="progress-section-head">
        <h2 className="progress-section-title">{title}</h2>
      </div>

      {summary === null ? null : <ProgressStreakSummary summary={summary} />}

      <div className="progress-streak-weeks">
        {streakWeeks.map((week, weekIndex) => (
          <div key={`streak-week-${weekIndex}`} className="progress-streak-week">
            {week.map((day) => (
              <ProgressStreakDay key={day.date} day={day} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
