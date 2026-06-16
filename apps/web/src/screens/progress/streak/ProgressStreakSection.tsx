import type { CSSProperties, ReactElement, Ref } from "react";
import { ReviewProgressBadgeIcon, StreakFreezeIcon } from "../../shared/ReviewProgressBadgeIcon";
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
  formattedFreezeValue: string;
}>;

type ProgressStreakSectionProps = Readonly<{
  title: string;
  sectionId: string;
  sectionRef: Ref<HTMLElement>;
  summary: ProgressStreakSummaryView | null;
  infoText: string | null;
  infoToggleLabel: string;
  isInfoVisible: boolean;
  onToggleInfo: () => void;
  streakWeeks: ReadonlyArray<ReadonlyArray<StreakDay>>;
}>;

function ProgressStreakDay(props: Readonly<{
  day: StreakDay;
}>): ReactElement {
  const { day } = props;
  const dayClassName = [
    "progress-streak-day",
    day.state === "reviewed" ? "progress-streak-day-complete" : "",
    day.state === "frozen" ? "progress-streak-day-frozen" : "",
    day.isToday && day.state === "pending" ? "progress-streak-day-today" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");

  return (
    <div
      className={dayClassName}
      title={day.title}
      data-streak-state={day.isFuture ? "future" : day.state}
      style={day.isFuture ? futureStreakDayStyle : undefined}
    >
      <span className="progress-streak-weekday">{day.weekdayLabel}</span>
      <span
        className="progress-streak-marker"
        aria-hidden="true"
        style={day.isFuture ? futureStreakMarkerStyle : undefined}
      >
        {day.state === "reviewed" ? (
          <span className="progress-streak-marker-flame">
            <ReviewProgressBadgeIcon />
          </span>
        ) : day.state === "frozen" ? (
          <span className="progress-streak-marker-freeze">
            <StreakFreezeIcon />
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
        <span className="review-progress-freeze-indicator" aria-hidden="true">
          <StreakFreezeIcon />
          <span className="review-progress-freeze-value">{summary.formattedFreezeValue}</span>
        </span>
      </span>
    </div>
  );
}

export function ProgressStreakSection(props: ProgressStreakSectionProps): ReactElement {
  const {
    title,
    sectionId,
    sectionRef,
    summary,
    infoText,
    infoToggleLabel,
    isInfoVisible,
    onToggleInfo,
    streakWeeks,
  } = props;

  return (
    <section
      id={sectionId}
      ref={sectionRef}
      className="content-card progress-section"
      data-testid="progress-streak-card"
    >
      <div className="progress-section-head">
        <h2 className="progress-section-title">{title}</h2>
        {infoText === null ? null : (
          <button
            type="button"
            className="ghost-btn progress-streak-info-btn"
            aria-expanded={isInfoVisible}
            aria-label={infoToggleLabel}
            onClick={onToggleInfo}
            data-testid="progress-streak-info-toggle"
          >
            <span className="progress-streak-info-icon" aria-hidden="true">i</span>
          </button>
        )}
      </div>

      {summary === null ? null : <ProgressStreakSummary summary={summary} />}

      {infoText !== null && isInfoVisible ? (
        <p className="progress-streak-info" data-testid="progress-streak-info">
          {infoText}
        </p>
      ) : null}

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
