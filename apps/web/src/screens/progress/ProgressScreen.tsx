import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type Ref } from "react";
import { Link, useLocation } from "react-router-dom";
import { buildLoginUrl } from "../../api";
import { useAppData } from "../../appData";
import {
  buildReviewProgressBadgeStateFromSummarySnapshot,
  formatReviewProgressBadgeValue,
} from "../../appData/progress/badge/reviewProgressBadge";
import { useProgressInvalidationState } from "../../appData/progress/invalidation/progressInvalidation";
import { canLoadProgressServerBase, useProgressSource } from "../../appData/progress/progressSource";
import { resolveLocaleWeekContext, useI18n, type LocaleDirection } from "../../i18n";
import { parseLocalDate, shiftLocalDate } from "../../progress/progressDates";
import { progressLeaderboardHash, settingsLeaderboardParticipationRoute } from "../../routes";
import type {
  DailyReviewPoint,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressReviewScheduleBucketKey,
  ProgressReviewScheduleSnapshot,
  ProgressSeriesSnapshot,
} from "../../types";
import { progressLeaderboardWindowKeys } from "../../types";
import { ReviewProgressBadgeIcon } from "../shared/ReviewProgressBadgeIcon";

const streakWeekCount = 5;
const streakWeekLength = 7;
const chartGuideLineCount = 3;

type LocaleValue = ReturnType<typeof useI18n>["locale"];
type DateFormatter = ReturnType<typeof useI18n>["formatDate"];
type NumberFormatter = ReturnType<typeof useI18n>["formatNumber"];
type Translate = ReturnType<typeof useI18n>["t"];
type WeekContext = ReturnType<typeof resolveLocaleWeekContext>;
type DailyReview = ProgressSeriesSnapshot["dailyReviews"][number];
type ChartNavigationDirection = "previous" | "next";
type StreakDay = Readonly<{
  date: string;
  reviewCount: number;
  isFuture: boolean;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  title: string;
}>;
type ChartDay = Readonly<{
  date: string;
  reviewCount: number;
  isToday: boolean;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  showMonthLabel: boolean;
  barHeightPercentage: number;
  title: string;
}>;
type ChartPage = Readonly<{
  days: ReadonlyArray<ChartDay>;
  startDate: string;
  endDate: string;
  startLocalDate: string;
  upperBound: number;
}>;
type ReviewScheduleBucketView = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  label: string;
  count: number;
  percentageLabel: string;
  color: string;
}>;
type ReviewScheduleDonutSegment = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  color: string;
  pathD: string;
}>;

// Canonical palette — see docs/progress-pie-palette.md.
// Keep the hex values in sync with the iOS and Android clients.
const reviewScheduleBucketColors: Readonly<Record<ProgressReviewScheduleBucketKey, string>> = {
  new: "#F4C430",
  today: "#D7263D",
  days1To7: "#1FB5C1",
  days8To30: "#8E5BD9",
  days31To90: "#2BB673",
  days91To360: "#E69F00",
  years1To2: "#3F7CC8",
  later: "#7A8088",
};

const reviewScheduleDonutOuterRadius = 100;
const reviewScheduleDonutInnerRadius = 62;

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

function formatLocalDateForDisplay(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWeekdayLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    weekday: "narrow",
  });
}

function formatDayLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    day: "numeric",
  });
}

function formatMonthLabel(value: string, formatDate: DateFormatter): string {
  return formatDate(parseLocalDate(value), {
    timeZone: "UTC",
    month: "short",
  });
}

function sortDailyReviews(dailyReviews: ProgressSeriesSnapshot["dailyReviews"]): ReadonlyArray<DailyReview> {
  return [...dailyReviews].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
}

function createDailyReviewCountMap(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyMap<string, number> {
  const reviewCounts = new Map<string, number>();

  for (const day of dailyReviews) {
    reviewCounts.set(day.date, day.reviewCount);
  }

  return reviewCounts;
}

function getDayOfWeek(value: string): number {
  return parseLocalDate(value).getUTCDay();
}

function getStartOfWeek(value: string, weekContext: WeekContext): string {
  const dayOfWeek = getDayOfWeek(value);
  const offsetFromWeekStart = (dayOfWeek - weekContext.firstDayOfWeek + streakWeekLength) % streakWeekLength;

  return shiftLocalDate(value, -offsetFromWeekStart);
}

export function buildStreakWeeks(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
  weekContext: WeekContext,
): ReadonlyArray<ReadonlyArray<StreakDay>> {
  const currentWeekStart = getStartOfWeek(today, weekContext);
  const streakWindowStart = shiftLocalDate(currentWeekStart, -((streakWeekCount - 1) * streakWeekLength));
  const reviewCounts = createDailyReviewCountMap(dailyReviews);
  const streakWeeks: Array<ReadonlyArray<StreakDay>> = [];

  for (let weekIndex = 0; weekIndex < streakWeekCount; weekIndex += 1) {
    const weekStart = shiftLocalDate(streakWindowStart, weekIndex * streakWeekLength);
    const weekDays: Array<StreakDay> = [];

    for (let dayOffset = 0; dayOffset < streakWeekLength; dayOffset += 1) {
      const date = shiftLocalDate(weekStart, dayOffset);
      weekDays.push({
        date,
        reviewCount: reviewCounts.get(date) ?? 0,
        isFuture: date > today,
        isToday: date === today,
        weekdayLabel: formatWeekdayLabel(date, formatDate),
        dayLabel: formatDayLabel(date, formatDate),
        title: formatLocalDateForDisplay(date, formatDate),
      });
    }

    streakWeeks.push(weekDays);
  }

  return streakWeeks;
}

function calculateMaxReviewCount(dailyReviews: ReadonlyArray<DailyReview>): number {
  return dailyReviews.reduce((maxReviewCount, day) => Math.max(maxReviewCount, day.reviewCount), 0);
}

function calculateChartUpperBound(maxReviewCount: number): number {
  if (maxReviewCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(maxReviewCount * 1.1));
}

function calculateBarHeightPercentage(reviewCount: number, upperBound: number): number {
  if (reviewCount === 0 || upperBound === 0) {
    return 0;
  }

  return (reviewCount / upperBound) * 100;
}

function buildChartPage(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
): ChartPage {
  const upperBound = calculateChartUpperBound(calculateMaxReviewCount(dailyReviews));

  return {
    days: dailyReviews.map((day, dayIndex): ChartDay => ({
      date: day.date,
      reviewCount: day.reviewCount,
      isToday: day.date === today,
      weekdayLabel: formatWeekdayLabel(day.date, formatDate),
      dayLabel: formatDayLabel(day.date, formatDate),
      monthLabel: formatMonthLabel(day.date, formatDate),
      showMonthLabel: dayIndex === 0 || dailyReviews[dayIndex - 1]?.date.slice(0, 7) !== day.date.slice(0, 7),
      barHeightPercentage: calculateBarHeightPercentage(day.reviewCount, upperBound),
      title: formatLocalDateForDisplay(day.date, formatDate),
    })),
    startDate: dailyReviews[0]?.date ?? "",
    endDate: dailyReviews[dailyReviews.length - 1]?.date ?? "",
    startLocalDate: dailyReviews[0]?.date ?? "",
    upperBound,
  };
}

function padPageDaysToFullWeek(
  pageDays: ReadonlyArray<DailyReview>,
  weekStart: string,
): ReadonlyArray<DailyReview> {
  const reviewCounts = createDailyReviewCountMap(pageDays);
  const fullWeek: Array<DailyReview> = [];

  for (let dayOffset = 0; dayOffset < streakWeekLength; dayOffset += 1) {
    const date = shiftLocalDate(weekStart, dayOffset);
    fullWeek.push({
      date,
      reviewCount: reviewCounts.get(date) ?? 0,
    });
  }

  return fullWeek;
}

function buildChartPages(
  dailyReviews: ReadonlyArray<DailyReview>,
  today: string,
  formatDate: DateFormatter,
  weekContext: WeekContext,
): ReadonlyArray<ChartPage> {
  if (dailyReviews.length === 0) {
    return [];
  }

  const chartPages: Array<ChartPage> = [];
  let currentPageDays: Array<DailyReview> = [];
  let currentWeekStart: string | null = null;

  for (const day of dailyReviews) {
    const weekStart = getStartOfWeek(day.date, weekContext);

    if (currentWeekStart !== null && currentWeekStart !== weekStart) {
      chartPages.push(buildChartPage(padPageDaysToFullWeek(currentPageDays, currentWeekStart), today, formatDate));
      currentPageDays = [day];
      currentWeekStart = weekStart;
      continue;
    }

    currentPageDays.push(day);
    currentWeekStart = weekStart;
  }

  if (currentPageDays.length > 0 && currentWeekStart !== null) {
    chartPages.push(buildChartPage(padPageDaysToFullWeek(currentPageDays, currentWeekStart), today, formatDate));
  }

  return chartPages;
}

function buildChartGuideLabels(upperBound: number, formatNumber: NumberFormatter): ReadonlyArray<string> {
  const labels: string[] = [];

  for (let index = 0; index < chartGuideLineCount; index += 1) {
    if (index === 0) {
      labels.push(formatNumber(upperBound));
      continue;
    }

    if (index === chartGuideLineCount - 1) {
      labels.push(formatNumber(0));
      continue;
    }

    labels.push("");
  }

  return labels;
}

function formatChartRangeLabel(startDate: string, endDate: string, locale: LocaleValue): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatRange(parseLocalDate(startDate), parseLocalDate(endDate));
}

function resolveChartNavigationArrow(
  localeDirection: LocaleDirection,
  navigationDirection: ChartNavigationDirection,
): string {
  if (navigationDirection === "previous") {
    return localeDirection === "rtl" ? ">" : "<";
  }

  return localeDirection === "rtl" ? "<" : ">";
}

function getReviewScheduleBucketLabel(bucketKey: ProgressReviewScheduleBucketKey, t: Translate): string {
  if (bucketKey === "new") {
    return t("progressScreen.reviewSchedule.buckets.new");
  }

  if (bucketKey === "today") {
    return t("progressScreen.reviewSchedule.buckets.today");
  }

  if (bucketKey === "days1To7") {
    return t("progressScreen.reviewSchedule.buckets.days1To7");
  }

  if (bucketKey === "days8To30") {
    return t("progressScreen.reviewSchedule.buckets.days8To30");
  }

  if (bucketKey === "days31To90") {
    return t("progressScreen.reviewSchedule.buckets.days31To90");
  }

  if (bucketKey === "days91To360") {
    return t("progressScreen.reviewSchedule.buckets.days91To360");
  }

  if (bucketKey === "years1To2") {
    return t("progressScreen.reviewSchedule.buckets.years1To2");
  }

  return t("progressScreen.reviewSchedule.buckets.later");
}

function formatReviewSchedulePercentage(count: number, totalCards: number, formatNumber: NumberFormatter): string {
  if (totalCards <= 0 || count <= 0) {
    return formatNumber(0, {
      style: "percent",
      maximumFractionDigits: 0,
    });
  }

  return formatNumber(count / totalCards, {
    style: "percent",
    maximumFractionDigits: 1,
  });
}

function buildReviewScheduleBucketViews(
  reviewSchedule: ProgressReviewScheduleSnapshot,
  t: Translate,
  formatNumber: NumberFormatter,
): ReadonlyArray<ReviewScheduleBucketView> {
  return reviewSchedule.buckets.map((bucket): ReviewScheduleBucketView => ({
    key: bucket.key,
    label: getReviewScheduleBucketLabel(bucket.key, t),
    count: bucket.count,
    percentageLabel: formatReviewSchedulePercentage(bucket.count, reviewSchedule.totalCards, formatNumber),
    color: reviewScheduleBucketColors[bucket.key],
  }));
}

function polarToCartesian(angleDegrees: number, radius: number): { x: number; y: number } {
  const angleRadians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: radius * Math.cos(angleRadians),
    y: radius * Math.sin(angleRadians),
  };
}

function buildAnnulusSegmentPath(startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  // Use `>=` (not `===`) to absorb floating-point drift in `(count / total) * 360`.
  if (sweep >= 360) {
    // Single full ring: split into two semicircle annulus arcs so the path is non-degenerate.
    const half = startAngle + 180;
    return [
      buildAnnulusSegmentPath(startAngle, half),
      buildAnnulusSegmentPath(half, startAngle + 360),
    ].join(" ");
  }
  const outerStart = polarToCartesian(startAngle, reviewScheduleDonutOuterRadius);
  const outerEnd = polarToCartesian(endAngle, reviewScheduleDonutOuterRadius);
  const innerStart = polarToCartesian(endAngle, reviewScheduleDonutInnerRadius);
  const innerEnd = polarToCartesian(startAngle, reviewScheduleDonutInnerRadius);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${reviewScheduleDonutOuterRadius} ${reviewScheduleDonutOuterRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${reviewScheduleDonutInnerRadius} ${reviewScheduleDonutInnerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

function buildReviewScheduleDonutSegments(
  bucketViews: ReadonlyArray<ReviewScheduleBucketView>,
): ReadonlyArray<ReviewScheduleDonutSegment> {
  const totalCount = bucketViews.reduce((totalCards, bucket) => totalCards + bucket.count, 0);
  if (totalCount <= 0) {
    return [];
  }
  const nonEmpty = bucketViews.filter((bucket) => bucket.count > 0);
  let currentAngle = 0;
  return nonEmpty.map((bucket): ReviewScheduleDonutSegment => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + (bucket.count / totalCount) * 360;
    currentAngle = endAngle;
    return {
      key: bucket.key,
      color: bucket.color,
      pathD: buildAnnulusSegmentPath(startAngle, endAngle),
    };
  });
}

function getLeaderboardPeriodLabel(windowKey: ProgressLeaderboardWindowKey, t: Translate): string {
  if (windowKey === "last_24_hours") {
    return t("progressScreen.leaderboard.periods.last24Hours");
  }

  if (windowKey === "last_3_days") {
    return t("progressScreen.leaderboard.periods.last3Days");
  }

  if (windowKey === "last_7_days") {
    return t("progressScreen.leaderboard.periods.last7Days");
  }

  if (windowKey === "last_30_days") {
    return t("progressScreen.leaderboard.periods.last30Days");
  }

  return t("progressScreen.leaderboard.periods.allTime");
}

type ProgressLeaderboardBodyProps = Readonly<{
  sourceState: ProgressLeaderboardSourceState;
  canRenderServerBase: boolean;
  selectedWindowKey: ProgressLeaderboardWindowKey | null;
  onSelectWindowKey: (windowKey: ProgressLeaderboardWindowKey) => void;
}>;

type ProgressLeaderboardSectionProps = ProgressLeaderboardBodyProps & Readonly<{
  sectionId: string;
  sectionRef: Ref<HTMLElement>;
  isInfoVisible: boolean;
  onToggleInfo: () => void;
}>;

function ProgressLeaderboardSignInPlaceholder(): ReactElement {
  const { locale, t } = useI18n();

  return (
    <div className="progress-leaderboard-placeholder" data-testid="progress-leaderboard-guest">
      <p className="subtitle">{t("progressScreen.leaderboard.guestBody")}</p>
      <a className="primary-btn" href={buildLoginUrl(window.location.origin, locale)}>
        {t("progressScreen.leaderboard.signIn")}
      </a>
    </div>
  );
}

function ProgressLeaderboardRows(props: Readonly<{
  window: ProgressLeaderboardWindow;
  showFreshness: boolean;
}>): ReactElement {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { window: leaderboardWindow, showFreshness } = props;

  return (
    <>
      <ol className="progress-leaderboard-list">
        {leaderboardWindow.rows.map((row, rowIndex) => {
          if (row.kind === "gap") {
            return (
              <li
                key={`leaderboard-gap-${rowIndex}`}
                className="progress-leaderboard-row progress-leaderboard-gap"
                data-kind="gap"
                data-testid="progress-leaderboard-row-gap"
                aria-hidden="true"
              >
                <span className="progress-leaderboard-gap-dots">…</span>
              </li>
            );
          }

          const rowClassName = row.kind === "viewer"
            ? "progress-leaderboard-row progress-leaderboard-row-viewer"
            : "progress-leaderboard-row";

          return (
            <li
              key={`${row.publicProfileId}-${row.rank}`}
              className={rowClassName}
              data-kind={row.kind}
              data-testid={`progress-leaderboard-row-${row.kind}`}
            >
              <span className="progress-leaderboard-rank">
                {t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(row.rank) })}
              </span>
              <span className="progress-leaderboard-name">
                {row.kind === "viewer" ? t("progressScreen.leaderboard.you") : row.anonymousDisplayName}
              </span>
              <span className="progress-leaderboard-count" data-testid={`progress-leaderboard-count-${row.kind}`}>
                {formatNumber(row.qualifiedReviewCount)}
              </span>
            </li>
          );
        })}
      </ol>
      {showFreshness ? (
        <p className="progress-chart-range" data-testid="progress-leaderboard-freshness">
          {t("progressScreen.leaderboard.updatedAt", {
            time: formatDateTime(leaderboardWindow.snapshotGeneratedAt),
          })}
        </p>
      ) : null}
    </>
  );
}

function ProgressLeaderboardBody(props: ProgressLeaderboardBodyProps): ReactElement {
  const { t } = useI18n();
  const { sourceState, canRenderServerBase, selectedWindowKey, onSelectWindowKey } = props;
  const leaderboard = sourceState.renderedSnapshot;

  if (canRenderServerBase === false) {
    return <ProgressLeaderboardSignInPlaceholder />;
  }

  if (leaderboard === null) {
    if (sourceState.errorMessage !== "" && sourceState.isLoading === false) {
      if (sourceState.isNetworkError) {
        return (
          <p className="subtitle" data-testid="progress-leaderboard-offline-empty">
            {t("progressScreen.leaderboard.offlineEmpty")}
          </p>
        );
      }

      return (
        <p className="subtitle" data-testid="progress-leaderboard-unavailable">
          {t("progressScreen.leaderboard.unavailable")}
        </p>
      );
    }

    return (
      <p className="subtitle" data-testid="progress-leaderboard-loading">
        {t("progressScreen.leaderboard.loading")}
      </p>
    );
  }

  if (leaderboard.status === "linked_account_required") {
    return <ProgressLeaderboardSignInPlaceholder />;
  }

  if (leaderboard.status === "participation_disabled") {
    return (
      <div className="progress-leaderboard-placeholder" data-testid="progress-leaderboard-participation-disabled">
        <p className="subtitle">{t("progressScreen.leaderboard.participationDisabledBody")}</p>
        <Link className="ghost-btn" to={settingsLeaderboardParticipationRoute}>
          {t("progressScreen.leaderboard.openParticipationSettings")}
        </Link>
      </div>
    );
  }

  if (leaderboard.status === "snapshot_unavailable") {
    return (
      <p className="subtitle" data-testid="progress-leaderboard-unavailable">
        {t("progressScreen.leaderboard.unavailable")}
      </p>
    );
  }

  const resolvedWindowKey = selectedWindowKey ?? leaderboard.defaultWindowKey;
  const leaderboardWindow = leaderboard.windows.find((window) => window.windowKey === resolvedWindowKey) ?? null;

  return (
    <>
      <div className="progress-leaderboard-periods" role="group" aria-label={t("progressScreen.leaderboard.periodsLabel")}>
        {progressLeaderboardWindowKeys.map((windowKey) => (
          <button
            key={windowKey}
            type="button"
            className={windowKey === resolvedWindowKey
              ? "progress-leaderboard-period-btn is-selected"
              : "progress-leaderboard-period-btn"}
            aria-pressed={windowKey === resolvedWindowKey}
            onClick={() => onSelectWindowKey(windowKey)}
            data-testid={`progress-leaderboard-period-${windowKey}`}
          >
            {getLeaderboardPeriodLabel(windowKey, t)}
          </button>
        ))}
      </div>
      {leaderboardWindow === null ? (
        <p className="subtitle" data-testid="progress-leaderboard-unavailable">
          {t("progressScreen.leaderboard.unavailable")}
        </p>
      ) : (
        <ProgressLeaderboardRows
          window={leaderboardWindow}
          showFreshness={sourceState.errorMessage !== ""}
        />
      )}
    </>
  );
}

function ProgressLeaderboardSection(props: ProgressLeaderboardSectionProps): ReactElement {
  const { t } = useI18n();
  const {
    sourceState,
    canRenderServerBase,
    selectedWindowKey,
    onSelectWindowKey,
    sectionId,
    sectionRef,
    isInfoVisible,
    onToggleInfo,
  } = props;

  return (
    <section
      id={sectionId}
      ref={sectionRef}
      className="content-card progress-section progress-leaderboard-card"
      data-testid="progress-leaderboard-card"
    >
      <div className="progress-section-head">
        <div className="progress-chart-heading">
          <h2 className="progress-section-title">{t("progressScreen.leaderboard.title")}</h2>
        </div>
        <button
          type="button"
          className="ghost-btn progress-leaderboard-info-btn"
          aria-expanded={isInfoVisible}
          aria-label={t("progressScreen.leaderboard.infoToggleLabel")}
          onClick={onToggleInfo}
          data-testid="progress-leaderboard-info-toggle"
        >
          <span className="progress-leaderboard-info-icon" aria-hidden="true">i</span>
        </button>
      </div>

      {isInfoVisible ? (
        <p className="progress-leaderboard-info" data-testid="progress-leaderboard-info">
          {t("progressScreen.leaderboard.info")}
        </p>
      ) : null}

      <ProgressLeaderboardBody
        sourceState={sourceState}
        canRenderServerBase={canRenderServerBase}
        selectedWindowKey={selectedWindowKey}
        onSelectWindowKey={onSelectWindowKey}
      />
    </section>
  );
}

export function ProgressScreen(): ReactElement {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
  } = useAppData();
  const {
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
  } = useProgressInvalidationState();
  const location = useLocation();
  const { progressSourceState, refreshProgress } = useProgressSource({
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    sections: {
      includeSummary: true,
      includeSeries: true,
      includeReviewSchedule: true,
      includeLeaderboard: true,
    },
  });
  const { locale, matchedBrowserLanguageTag, direction, t, formatDate, formatNumber } = useI18n();
  const [selectedPageStartLocalDate, setSelectedPageStartLocalDate] = useState<string | null>(null);
  const [selectedReviewScheduleBucket, setSelectedReviewScheduleBucket] = useState<ProgressReviewScheduleBucketKey | null>(null);
  const [selectedLeaderboardWindowKey, setSelectedLeaderboardWindowKey] = useState<ProgressLeaderboardWindowKey | null>(null);
  const [isLeaderboardInfoVisible, setIsLeaderboardInfoVisible] = useState<boolean>(false);
  const leaderboardSectionRef = useRef<HTMLElement | null>(null);
  const progressSummary = progressSourceState.summary.renderedSnapshot;
  const progress = progressSourceState.series.renderedSnapshot;
  const reviewSchedule = progressSourceState.reviewSchedule.renderedSnapshot;
  const isLoading = progressSourceState.summary.isLoading
    || progressSourceState.series.isLoading
    || progressSourceState.reviewSchedule.isLoading;
  const errorMessage = progressSourceState.summary.errorMessage !== ""
    ? progressSourceState.summary.errorMessage
    : progressSourceState.series.errorMessage !== ""
      ? progressSourceState.series.errorMessage
      : progressSourceState.reviewSchedule.errorMessage;
  const reviewProgressBadge = buildReviewProgressBadgeStateFromSummarySnapshot(progressSummary);

  useEffect(() => {
    setSelectedPageStartLocalDate(null);
  }, [progressSourceState.series.renderedSnapshot]);

  useEffect(() => {
    setSelectedReviewScheduleBucket(null);
  }, [progressSourceState.reviewSchedule.renderedSnapshot]);

  useEffect(() => {
    if (location.hash !== `#${progressLeaderboardHash}` || progress === null) {
      return;
    }

    const leaderboardSection = leaderboardSectionRef.current;
    if (leaderboardSection === null) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      leaderboardSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [location.hash, progress, progressSourceState.leaderboard.renderedSnapshot]);

  const dailyReviews = progress === null ? [] : sortDailyReviews(progress.dailyReviews);
  const today = progress === null ? "" : progress.to;
  const weekContext = resolveLocaleWeekContext(matchedBrowserLanguageTag ?? locale, locale);
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, today, formatDate, weekContext);
  const chartPages = progress === null ? [] : buildChartPages(dailyReviews, today, formatDate, weekContext);
  const selectedPageIndex = chartPages.findIndex((page) => page.startLocalDate === selectedPageStartLocalDate);
  const visiblePage = chartPages.length === 0
    ? null
    : selectedPageStartLocalDate === null || selectedPageIndex === -1
      ? chartPages[chartPages.length - 1]
      : chartPages[selectedPageIndex];
  const resolvedSelectedPageIndex = visiblePage === null
    ? 0
    : chartPages.findIndex((page) => page.startLocalDate === visiblePage.startLocalDate);
  const chartGuideLabels = buildChartGuideLabels(visiblePage?.upperBound ?? 1, formatNumber);
  const pageRangeLabel = visiblePage === null
    ? ""
    : formatChartRangeLabel(visiblePage.startDate, visiblePage.endDate, locale);
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });
  const previousWeekArrow = resolveChartNavigationArrow(direction, "previous");
  const nextWeekArrow = resolveChartNavigationArrow(direction, "next");
  // The bucket views and donut segments are derived from the snapshot on every render.
  // The work is cheap (8 buckets, short string concats and arc math); a useMemo here
  // would be a no-op because t/formatNumber from useI18n are rebuilt per render.
  const reviewScheduleBucketViews = reviewSchedule === null
    ? []
    : buildReviewScheduleBucketViews(reviewSchedule, t, formatNumber);
  const reviewScheduleDonutSegments = buildReviewScheduleDonutSegments(reviewScheduleBucketViews);
  const canRenderLeaderboardServerBase = canLoadProgressServerBase(sessionVerificationState, cloudSettings);
  const reviewScheduleHasSelection = selectedReviewScheduleBucket !== null;
  const handleSelectReviewScheduleBucket = (bucketKey: ProgressReviewScheduleBucketKey): void => {
    setSelectedReviewScheduleBucket((previous) => (previous === bucketKey ? null : bucketKey));
  };
  const handleClearReviewScheduleSelection = (): void => {
    setSelectedReviewScheduleBucket(null);
  };

  return (
    <main className="container">
      <section className="panel progress-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("progressScreen.title")}</h1>
            <p className="subtitle">{t("progressScreen.subtitle")}</p>
          </div>

          <button className="ghost-btn" type="button" onClick={() => void refreshProgress()}>
            {t("common.refresh")}
          </button>
        </div>

        {isLoading && progress === null ? <p className="subtitle">{t("loading.progress")}</p> : null}

        {errorMessage !== "" ? (
          <>
            <p className="error-banner">{errorMessage}</p>
          </>
        ) : null}

        {progress !== null ? (
          <div className="progress-layout">
            <section className="content-card progress-section">
              <div className="progress-section-head">
                <h2 className="progress-section-title">{t("progressScreen.streakTitle")}</h2>
              </div>

              {progressSummary !== null ? (
                <div className="progress-streak-summary">
                  <div className="progress-streak-summary-copy">
                    <span className="progress-streak-summary-label">{t("reviewScreen.progressBadge.title")}</span>
                    <p className="progress-streak-summary-status">{reviewProgressBadgeTodayStatus}</p>
                  </div>
                  <span
                    className={`badge review-progress-badge progress-streak-summary-badge${reviewProgressBadge.hasReviewedToday ? " review-progress-badge-active" : ""}`}
                    aria-label={reviewProgressBadgeAriaLabel}
                    title={reviewProgressBadgeAriaLabel}
                  >
                    <ReviewProgressBadgeIcon />
                    <span className="review-progress-badge-value">
                      {formatReviewProgressBadgeValue(reviewProgressBadge.streakDays)}
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="progress-streak-weeks">
                {streakWeeks.map((week, weekIndex) => (
                  <div key={`streak-week-${weekIndex}`} className="progress-streak-week">
                    {week.map((day) => {
                      const dayClassName = [
                        "progress-streak-day",
                        day.reviewCount > 0 ? "progress-streak-day-complete" : "",
                        day.isToday && day.reviewCount === 0 ? "progress-streak-day-today" : "",
                      ]
                        .filter((className) => className !== "")
                        .join(" ");

                      return (
                        <div
                          key={day.date}
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
                    })}
                  </div>
                ))}
              </div>
            </section>

            <section className="content-card progress-section">
              <div className="progress-section-head">
                <div className="progress-chart-heading">
                  <h2 className="progress-section-title">{t("progressScreen.reviewsTitle")}</h2>
                  {visiblePage !== null ? (
                    <p className="progress-chart-range" data-testid="progress-chart-range">
                      {pageRangeLabel}
                    </p>
                  ) : null}
                </div>

                {chartPages.length > 1 ? (
                  <div className="progress-chart-nav">
                    <button
                      type="button"
                      className="ghost-btn progress-chart-nav-btn"
                      onClick={() => setSelectedPageStartLocalDate(chartPages[resolvedSelectedPageIndex - 1]?.startLocalDate ?? null)}
                      disabled={resolvedSelectedPageIndex <= 0}
                      aria-label={t("progressScreen.previousWeek")}
                      data-testid="progress-chart-previous-week"
                    >
                      <span className="progress-chart-nav-icon" aria-hidden="true">
                        {previousWeekArrow}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ghost-btn progress-chart-nav-btn"
                      onClick={() => setSelectedPageStartLocalDate(chartPages[resolvedSelectedPageIndex + 1]?.startLocalDate ?? null)}
                      disabled={resolvedSelectedPageIndex >= chartPages.length - 1}
                      aria-label={t("progressScreen.nextWeek")}
                      data-testid="progress-chart-next-week"
                    >
                      <span className="progress-chart-nav-icon" aria-hidden="true">
                        {nextWeekArrow}
                      </span>
                    </button>
                  </div>
                ) : null}
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
                      {visiblePage.days.map((day) => {
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
                            key={day.date}
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
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {reviewSchedule !== null ? (
              <section
                className="content-card progress-section"
                data-testid="progress-review-schedule-card"
                onClick={handleClearReviewScheduleSelection}
              >
                <div className="progress-section-head">
                  <div className="progress-chart-heading">
                    <h2 className="progress-section-title">{t("progressScreen.reviewSchedule.title")}</h2>
                    <p className="progress-chart-range">
                      {t("progressScreen.reviewSchedule.totalCards", {
                        count: formatNumber(reviewSchedule.totalCards),
                      })}
                    </p>
                  </div>
                </div>

                <div className="progress-review-schedule">
                  {reviewScheduleDonutSegments.length > 0 ? (
                    <svg
                      className="progress-review-schedule-donut"
                      viewBox="-110 -110 220 220"
                      role="img"
                      aria-label={t("progressScreen.reviewSchedule.title")}
                    >
                      {reviewScheduleDonutSegments.map((segment) => {
                        const isSelected = selectedReviewScheduleBucket === segment.key;
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
                              handleSelectReviewScheduleBucket(segment.key);
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
                    aria-label={t("progressScreen.reviewSchedule.legendLabel")}
                  >
                    {reviewScheduleBucketViews.map((bucket) => {
                      const isSelected = selectedReviewScheduleBucket === bucket.key;
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
                              handleSelectReviewScheduleBucket(bucket.key);
                            }}
                          >
                            <span
                              className="progress-review-schedule-swatch"
                              style={{ backgroundColor: bucket.color }}
                              aria-hidden="true"
                            />
                            <span className="progress-review-schedule-label">{bucket.label}</span>
                            <span className="progress-review-schedule-values">
                              <span className="progress-review-schedule-count">{formatNumber(bucket.count)}</span>
                              <span className="progress-review-schedule-percent">{bucket.percentageLabel}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            ) : null}

            <ProgressLeaderboardSection
              sectionId={progressLeaderboardHash}
              sectionRef={leaderboardSectionRef}
              sourceState={progressSourceState.leaderboard}
              canRenderServerBase={canRenderLeaderboardServerBase}
              selectedWindowKey={selectedLeaderboardWindowKey}
              onSelectWindowKey={setSelectedLeaderboardWindowKey}
              isInfoVisible={isLeaderboardInfoVisible}
              onToggleInfo={() => setIsLeaderboardInfoVisible((previous) => previous === false)}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
