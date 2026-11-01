import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { liveSourceBarFreshness, type BreakdownBucket, type BreakdownReport } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import {
  getPaymentSeriesTotal, loadWhoPaidUsReport, paymentProviderLabels, paymentProviders, paymentSeries,
  type PaymentProvider, type WhoPaidUsBucket, type WhoPaidUsReport,
} from "./query";

export function formatPaymentProvider(value: string): string {
  const provider = paymentProviders.find((entry) => entry === value);
  if (provider === undefined) throw new Error(`Who paid us by provider has no label for value ${value}.`);
  return paymentProviderLabels[provider];
}

function sumProviderEvents(entry: WhoPaidUsBucket, provider: PaymentProvider): number {
  return paymentSeries.reduce((sum, series) => sum + (entry.providers[provider].counts[series] ?? 0), 0);
}

/**
 * Available exactly when the Who paid us bar shows a recorded total, which these provider counts add up to.
 * Only Stripe and a provider outside the selected platforms can be `complete` in the SQL, so an available bar
 * holds a recorded classified event while Apple or Google is selected, and can total a proven 0 otherwise;
 * the breakdown's explanation states both cases.
 */
function buildProviderBucket(entry: WhoPaidUsBucket, providers: ReadonlyArray<PaymentProvider>): BreakdownBucket {
  return {
    bucket: entry.bucket,
    countsByValue: paymentSeries.every((series) => getPaymentSeriesTotal(entry, series) === null)
      ? null
      : new Map<string, number>(providers.map((provider) => [provider, sumProviderEvents(entry, provider)])),
    freshness: liveSourceBarFreshness(entry.bucket),
  };
}

/** The Who paid us events of each bucket split by provider, so a bar adds up to the Who paid us bar for the same bucket. */
function buildWhoPaidUsProviderBreakdownReport(report: WhoPaidUsReport): BreakdownReport {
  return {
    generatedAtUtc: report.generatedAtUtc,
    period: report.period,
    today: report.today,
    values: report.providers,
    valueLabels: null,
    buckets: report.buckets.map((entry) => buildProviderBucket(entry, report.providers)),
  };
}

export async function loadWhoPaidUsProviderBreakdownReport(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  signal: AbortSignal,
): Promise<BreakdownReport> {
  return buildWhoPaidUsProviderBreakdownReport(await loadWhoPaidUsReport(config, dateRange, period, eventPlatforms, signal));
}
