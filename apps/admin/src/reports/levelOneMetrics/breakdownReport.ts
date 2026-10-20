import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import type { ReportBucket, ReportPeriod } from "./reportPeriod";

/** Whether a bar's source has delivered its days yet, and whether their numbers can still change. */
export type BarFreshness = "not-arrived" | "not-final" | "final";

export type BarFreshnessRule = (bucket: ReportBucket) => BarFreshness;

/** A source recorded live, whose bars are final as soon as they are counted. */
export const liveSourceBarFreshness: BarFreshnessRule = () => "final";

export type BreakdownBucket = Readonly<{
  bucket: ReportBucket;
  /** Null when the bar is unavailable. */
  countsByValue: ReadonlyMap<string, number> | null;
  freshness: BarFreshness;
}>;

/** One Level 1 chart split by one dimension. */
export type BreakdownReport = Readonly<{
  generatedAtUtc: string;
  period: ReportPeriod;
  today: string;
  /** Every value a bar holds, in stack order from the bottom. */
  values: ReadonlyArray<string>;
  buckets: ReadonlyArray<BreakdownBucket>;
}>;

export type BreakdownReportLoader = (
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  signal: AbortSignal,
) => Promise<BreakdownReport>;
