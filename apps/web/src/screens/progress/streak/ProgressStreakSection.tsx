import type { ReactElement, Ref } from "react";
import { ReviewProgressBadgeIcon, StreakFreezeIcon } from "../../shared/ReviewProgressBadgeIcon";
import type { StreakDay } from "./progressStreakModel";

export type ProgressStreakSummaryView = Readonly<{
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
  formatDayAriaLabel: (day: StreakDay) => string;
}>;

function ProgressStreakDay(props: Readonly<{
  day: StreakDay;
  formatDayAriaLabel: (day: StreakDay) => string;
}>): ReactElement {
  const { day, formatDayAriaLabel } = props;
  const dayClassName = [
    "progress-streak-day",
    day.state === "reviewed" ? "progress-streak-day-complete" : "",
    day.state === "frozen" ? "progress-streak-day-frozen" : "",
    day.isFuture ? "progress-streak-day-future" : "",
    day.isToday && day.state === "pending" ? "progress-streak-day-today" : "",
  ]
    .filter((className) => className !== "")
    .join(" ");

  return (
    <div
      className={dayClassName}
      title={day.title}
      data-streak-state={day.isFuture ? "future" : day.state}
      aria-label={formatDayAriaLabel(day)}
    >
      <span className="progress-streak-marker" aria-hidden="true">
        {day.state === "reviewed" ? (
          <span className="progress-streak-marker-flame">
            <ReviewProgressBadgeIcon />
          </span>
        ) : day.state === "frozen" ? (
          <span className="progress-streak-marker-freeze">
            <StreakFreezeIcon />
          </span>
        ) : (
          <span className="progress-streak-marker-day-value">{day.dayLabel}</span>
        )}
      </span>
    </div>
  );
}

function ProgressStreakSummary(props: Readonly<{
  summary: ProgressStreakSummaryView;
  infoToggleLabel: string;
  isInfoVisible: boolean;
  canShowInfo: boolean;
  onToggleInfo: () => void;
}>): ReactElement {
  const { summary, infoToggleLabel, isInfoVisible, canShowInfo, onToggleInfo } = props;

  return (
    <div className="progress-streak-summary">
      <span
        className={`progress-streak-chip progress-streak-value-chip${summary.hasReviewedToday ? " is-active" : ""}`}
        aria-label={summary.ariaLabel}
        title={summary.ariaLabel}
      >
        <ReviewProgressBadgeIcon />
        <span className="progress-streak-chip-value">
          {summary.formattedStreakValue}
        </span>
      </span>

      {canShowInfo ? (
        <button
          type="button"
          className="progress-streak-chip progress-streak-freeze-chip"
          aria-expanded={isInfoVisible}
          aria-label={infoToggleLabel}
          title={infoToggleLabel}
          onClick={onToggleInfo}
          data-testid="progress-streak-info-toggle"
        >
          <StreakFreezeIcon />
          <span className="progress-streak-chip-value">{summary.formattedFreezeValue}</span>
          <span className="progress-streak-freeze-info-icon" aria-hidden="true">i</span>
        </button>
      ) : (
        <span className="progress-streak-chip progress-streak-freeze-chip">
          <StreakFreezeIcon />
          <span className="progress-streak-chip-value">{summary.formattedFreezeValue}</span>
        </span>
      )}
    </div>
  );
}

function ProgressStreakWeekdayLabels(props: Readonly<{
  days: ReadonlyArray<StreakDay>;
}>): ReactElement {
  const { days } = props;

  return (
    <div className="progress-streak-weekdays" aria-hidden="true">
      {days.map((day) => (
        <span key={`weekday-${day.date}`} className="progress-streak-weekday">
          {day.weekdayLabel}
        </span>
      ))}
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
    formatDayAriaLabel,
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
      </div>

      {summary === null ? null : (
        <ProgressStreakSummary
          summary={summary}
          infoToggleLabel={infoToggleLabel}
          isInfoVisible={isInfoVisible}
          canShowInfo={infoText !== null}
          onToggleInfo={onToggleInfo}
        />
      )}

      {infoText !== null && isInfoVisible ? (
        <p className="progress-streak-info" data-testid="progress-streak-info">
          {infoText}
        </p>
      ) : null}

      <div className="progress-streak-calendar">
        <ProgressStreakWeekdayLabels days={streakWeeks[0] ?? []} />
        <div className="progress-streak-weeks">
          {streakWeeks.map((week, weekIndex) => (
            <div key={`streak-week-${weekIndex}`} className="progress-streak-week">
              {week.map((day) => (
                <ProgressStreakDay key={day.date} day={day} formatDayAriaLabel={formatDayAriaLabel} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
