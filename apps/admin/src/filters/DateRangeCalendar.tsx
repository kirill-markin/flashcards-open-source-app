import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { ReportRangePresetRow } from "../reports/ReportRangePresetRow";
import {
  buildRequestedDateRange,
  formatCalendarDate,
  parseCalendarDate,
} from "../reports/reportValues";

// One picker for both ends of a range of whole UTC days. Every cell is built with `Date.UTC`
// arithmetic and compared as a `YYYY-MM-DD` string, where lexical order is calendar order, so the
// browser timezone can never shift a day.

const dateRangeCalendarLabel = "Date range calendar";

const visibleMonthCount = 2;

const weekdayLabels: ReadonlyArray<string> = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type DateRangeCalendarRange = Readonly<{ from: string; to: string }>;

type CalendarMonth = Readonly<{
  monthStart: string;
  title: string;
  leadingBlankCount: number;
  dayValues: ReadonlyArray<string>;
}>;

function startOfUtcMonth(dayValue: string): string {
  const date = parseCalendarDate(dayValue, dateRangeCalendarLabel);
  return formatCalendarDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function addUtcMonths(monthStart: string, monthCount: number): string {
  const date = parseCalendarDate(monthStart, dateRangeCalendarLabel);
  return formatCalendarDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthCount, 1)));
}

function addUtcDays(dayValue: string, dayCount: number): string {
  const date = parseCalendarDate(dayValue, dateRangeCalendarLabel);
  return formatCalendarDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayCount)),
  );
}

function getUtcDayNumber(dayValue: string): number {
  return parseCalendarDate(dayValue, dateRangeCalendarLabel).getUTCDate();
}

// Monday-first grid: the blank count is how far the first of the month sits from Monday.
function buildCalendarMonth(monthStart: string): CalendarMonth {
  const monthStartDate = parseCalendarDate(monthStart, dateRangeCalendarLabel);
  const monthEnd = addUtcDays(addUtcMonths(monthStart, 1), -1);

  return {
    monthStart,
    title: monthStartDate.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }),
    leadingBlankCount: (monthStartDate.getUTCDay() + 6) % 7,
    dayValues: buildRequestedDateRange(monthStart, monthEnd, dateRangeCalendarLabel),
  };
}

function clampDay(dayValue: string, availableRange: DateRangeCalendarRange): string {
  if (dayValue < availableRange.from) {
    return availableRange.from;
  }

  if (dayValue > availableRange.to) {
    return availableRange.to;
  }

  return dayValue;
}

// The left month of the pair, held so neither month can leave the available range behind: the pair
// never starts before the first available month and never ends after the last one.
function clampVisibleMonthStart(
  monthStart: string,
  availableRange: DateRangeCalendarRange,
): string {
  const earliestMonthStart = startOfUtcMonth(availableRange.from);
  const lastPairMonthStart = addUtcMonths(startOfUtcMonth(availableRange.to), 1 - visibleMonthCount);
  const latestMonthStart = lastPairMonthStart < earliestMonthStart ? earliestMonthStart : lastPairMonthStart;

  if (monthStart < earliestMonthStart) {
    return earliestMonthStart;
  }

  if (monthStart > latestMonthStart) {
    return latestMonthStart;
  }

  return monthStart;
}

function isDayVisible(dayValue: string, visibleMonthStart: string): boolean {
  return dayValue >= visibleMonthStart && dayValue < addUtcMonths(visibleMonthStart, visibleMonthCount);
}

function isDayUnavailable(dayValue: string, availableRange: DateRangeCalendarRange): boolean {
  return dayValue < availableRange.from || dayValue > availableRange.to;
}

// Out-of-range days carry their own class: they are disabled for a different reason than a loading
// report, and only they may lose the range highlight.
function getDayClassName(
  dayValue: string,
  highlightRange: DateRangeCalendarRange,
  availableRange: DateRangeCalendarRange,
): string {
  const classNames = ["calendar-day"];

  if (isDayUnavailable(dayValue, availableRange)) {
    classNames.push("calendar-day-unavailable");
  }

  if (dayValue >= highlightRange.from && dayValue <= highlightRange.to) {
    classNames.push("in-range");
  }

  if (dayValue === highlightRange.from) {
    classNames.push("range-start");
  }

  if (dayValue === highlightRange.to) {
    classNames.push("range-end");
  }

  return classNames.join(" ");
}

function getKeyboardTargetDay(key: string, dayValue: string): string | null {
  if (key === "ArrowLeft") {
    return addUtcDays(dayValue, -1);
  }

  if (key === "ArrowRight") {
    return addUtcDays(dayValue, 1);
  }

  if (key === "ArrowUp") {
    return addUtcDays(dayValue, -7);
  }

  if (key === "ArrowDown") {
    return addUtcDays(dayValue, 7);
  }

  if (key === "Home") {
    return startOfUtcMonth(dayValue);
  }

  if (key === "End") {
    return addUtcDays(addUtcMonths(startOfUtcMonth(dayValue), 1), -1);
  }

  return null;
}

function getRangeSummary(
  selectedRange: DateRangeCalendarRange,
  pendingStart: string | null,
): string {
  if (pendingStart === null) {
    return `${selectedRange.from} to ${selectedRange.to} UTC`;
  }

  return `${pendingStart} to ... - pick the other end`;
}

// A controlled picker: it owns which months are on screen and which end is half-picked, and reports
// only complete ranges. The first click starts a range, the second one closes it, and a second click
// before the start swaps the ends rather than refusing the day.
export function DateRangeCalendar(
  props: Readonly<{
    availableRange: DateRangeCalendarRange;
    selectedRange: DateRangeCalendarRange;
    isDisabled: boolean;
    onRangeChange: (range: DateRangeCalendarRange) => void;
  }>,
): JSX.Element {
  const [visibleMonthStart, setVisibleMonthStart] = useState(
    () => clampVisibleMonthStart(startOfUtcMonth(props.selectedRange.from), props.availableRange),
  );
  const [focusedDay, setFocusedDay] = useState(
    () => clampDay(props.selectedRange.from, props.availableRange),
  );
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [lastSelectionKey, setLastSelectionKey] = useState(
    `${props.selectedRange.from}/${props.selectedRange.to}`,
  );
  const focusedDayButtonRef = useRef<HTMLButtonElement | null>(null);
  // Bumped once per keyboard move so the focus effect runs exactly once per request. A bare
  // after-every-render flag would stay armed whenever the move is clamped back onto the day that
  // already holds focus, and would then steal focus on the next unrelated render.
  const [focusRequestCount, setFocusRequestCount] = useState(0);

  // A selection made elsewhere, such as a preset, drops a half-picked end and pulls the months back
  // only when the new start is off screen, so month navigation survives a selection inside it.
  const selectionKey = `${props.selectedRange.from}/${props.selectedRange.to}`;
  if (lastSelectionKey !== selectionKey) {
    setLastSelectionKey(selectionKey);
    setPendingStart(null);

    if (isDayVisible(props.selectedRange.from, visibleMonthStart) === false) {
      setVisibleMonthStart(
        clampVisibleMonthStart(startOfUtcMonth(props.selectedRange.from), props.availableRange),
      );
    }
  }

  useEffect(() => {
    if (focusRequestCount === 0) {
      return;
    }

    const dayButton = focusedDayButtonRef.current;
    if (dayButton === null) {
      return;
    }

    dayButton.focus();
  }, [focusRequestCount]);

  function handleMonthStep(monthCount: number): void {
    setVisibleMonthStart(
      clampVisibleMonthStart(addUtcMonths(visibleMonthStart, monthCount), props.availableRange),
    );
  }

  function moveFocusToDay(dayValue: string): void {
    const targetDay = clampDay(dayValue, props.availableRange);
    setFocusedDay(targetDay);
    setFocusRequestCount((requestCount) => requestCount + 1);

    if (isDayVisible(targetDay, visibleMonthStart)) {
      return;
    }

    const targetMonthStart = targetDay < visibleMonthStart
      ? startOfUtcMonth(targetDay)
      : addUtcMonths(startOfUtcMonth(targetDay), 1 - visibleMonthCount);
    setVisibleMonthStart(clampVisibleMonthStart(targetMonthStart, props.availableRange));
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, dayValue: string): void {
    const targetDay = getKeyboardTargetDay(event.key, dayValue);
    if (targetDay === null) {
      return;
    }

    event.preventDefault();
    moveFocusToDay(targetDay);
  }

  function handleDaySelect(dayValue: string): void {
    setFocusedDay(dayValue);

    if (pendingStart === null) {
      setPendingStart(dayValue);
      return;
    }

    setPendingStart(null);
    props.onRangeChange(
      dayValue < pendingStart
        ? { from: dayValue, to: pendingStart }
        : { from: pendingStart, to: dayValue },
    );
  }

  function handlePresetSelect(range: DateRangeCalendarRange): void {
    setPendingStart(null);
    props.onRangeChange(range);
  }

  const months: ReadonlyArray<CalendarMonth> = Array.from(
    { length: visibleMonthCount },
    (_value, monthIndex) => buildCalendarMonth(addUtcMonths(visibleMonthStart, monthIndex)),
  );
  const selectableDayValues = months
    .flatMap((month) => month.dayValues)
    .filter((dayValue) => dayValue >= props.availableRange.from && dayValue <= props.availableRange.to);
  // The roving tab stop has to be a day that is on screen and pickable, or the grid drops out of the
  // tab order once navigation moves past the focused day.
  const tabStopDay = selectableDayValues.includes(focusedDay) ? focusedDay : selectableDayValues[0];
  const highlightRange: DateRangeCalendarRange = pendingStart === null
    ? props.selectedRange
    : { from: pendingStart, to: pendingStart };
  const isPreviousMonthDisabled = props.isDisabled
    || clampVisibleMonthStart(addUtcMonths(visibleMonthStart, -1), props.availableRange) === visibleMonthStart;
  const isNextMonthDisabled = props.isDisabled
    || clampVisibleMonthStart(addUtcMonths(visibleMonthStart, 1), props.availableRange) === visibleMonthStart;

  return (
    <div
      className={props.isDisabled ? "date-range-calendar date-range-calendar-busy" : "date-range-calendar"}
      role="group"
      aria-label="UTC date range calendar"
    >
      <div className="date-range-calendar-body">
        <div className="calendar-nav">
          <button
            className="filter-button filter-button-compact"
            type="button"
            data-testid="range-calendar-previous-month"
            aria-label="Previous month"
            disabled={isPreviousMonthDisabled}
            onClick={() => handleMonthStep(-1)}
          >
            Prev
          </button>
          <span className="calendar-nav-summary" aria-live="polite">
            {getRangeSummary(props.selectedRange, pendingStart)}
          </span>
          <button
            className="filter-button filter-button-compact"
            type="button"
            data-testid="range-calendar-next-month"
            aria-label="Next month"
            disabled={isNextMonthDisabled}
            onClick={() => handleMonthStep(1)}
          >
            Next
          </button>
        </div>

        <div className="calendar-months">
          {months.map((month, monthIndex) => (
            <div
              key={month.monthStart}
              className="calendar-month"
              data-testid={`range-calendar-month-${monthIndex}`}
              role="group"
              aria-label={month.title}
            >
              <p className="calendar-month-title">{month.title}</p>
              <div className="calendar-weekday-row" aria-hidden="true">
                {weekdayLabels.map((weekdayLabel) => <span key={weekdayLabel}>{weekdayLabel}</span>)}
              </div>
              <div className="calendar-day-grid">
                {Array.from({ length: month.leadingBlankCount }, (_value, blankIndex) => (
                  <span key={`${month.monthStart}-blank-${blankIndex}`} className="calendar-day-blank" />
                ))}
                {month.dayValues.map((dayValue) => (
                  <button
                    key={dayValue}
                    ref={dayValue === tabStopDay ? focusedDayButtonRef : null}
                    className={getDayClassName(dayValue, highlightRange, props.availableRange)}
                    type="button"
                    data-testid={`range-calendar-day-${dayValue}`}
                    aria-label={dayValue}
                    tabIndex={dayValue === tabStopDay ? 0 : -1}
                    disabled={props.isDisabled || isDayUnavailable(dayValue, props.availableRange)}
                    onClick={() => handleDaySelect(dayValue)}
                    onKeyDown={(event) => handleDayKeyDown(event, dayValue)}
                  >
                    {getUtcDayNumber(dayValue)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReportRangePresetRow
        availableRange={props.availableRange}
        isDisabled={props.isDisabled}
        onPresetSelect={handlePresetSelect}
      />
    </div>
  );
}
