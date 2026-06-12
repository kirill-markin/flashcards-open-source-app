import type { TranslationKey, TranslationValues } from "../../../i18n";
import type {
  ProgressReviewScheduleBucketKey,
  ProgressReviewScheduleSnapshot,
} from "../../../types";

type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export type ReviewScheduleBucketView = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  label: string;
  count: number;
  countLabel: string;
  percentageLabel: string;
  color: string;
}>;

export type ReviewScheduleDonutSegment = Readonly<{
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

export function buildReviewScheduleBucketViews(
  reviewSchedule: ProgressReviewScheduleSnapshot,
  t: Translate,
  formatNumber: NumberFormatter,
): ReadonlyArray<ReviewScheduleBucketView> {
  return reviewSchedule.buckets.map((bucket): ReviewScheduleBucketView => ({
    key: bucket.key,
    label: getReviewScheduleBucketLabel(bucket.key, t),
    count: bucket.count,
    countLabel: formatNumber(bucket.count),
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

export function buildReviewScheduleDonutSegments(
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
