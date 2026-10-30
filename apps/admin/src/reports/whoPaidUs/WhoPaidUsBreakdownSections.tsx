import { useMemo, type JSX } from "react";
import type { ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { BreakdownReportLoader } from "../levelOneMetrics/breakdownReport";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { PaymentImportStatusSection } from "./PaymentImportStatusSection";
import { formatPaymentProvider, loadWhoPaidUsProviderBreakdownReport } from "./providerBreakdown";

/** The Who paid us Details sections: the provider breakdown beside the chart, then the payment import status. */
export function WhoPaidUsBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
  const eventPlatforms = props.eventPlatforms;
  // `BreakdownSection` reloads when its loader changes, so it closes over the platforms here.
  const loadByProvider = useMemo((): BreakdownReportLoader => (config, dateRange, period, signal) => (
    loadWhoPaidUsProviderBreakdownReport(config, dateRange, period, eventPlatforms, signal)
  ), [eventPlatforms]);
  return (
    <>
      <BreakdownSection
        config={props.config}
        dateRange={props.dateRange}
        period={props.period}
        onTerminalAdminError={props.onTerminalAdminError}
        title="Who paid us by provider"
        testId="who-paid-us-by-provider-section"
        explanationId="who-paid-us-by-provider-explanation"
        explanation={<>
          <li>The trial starts, first payments and recurring payments of Who paid us together, under the provider that recorded them, so each bar adds up to that chart’s bar for the same day, week or month.</li>
          <li>These are events, not unique people, revenue or active paying customers.</li>
          <li>The Platform filter keeps only the providers of the selected platforms: Apple for iOS, Google for Android and Stripe for web.</li>
          <li>Apple and Google merchant history is partial, so counts are partial and cannot prove zero. A bar with no recorded classified trial start, first payment or recurring payment is unavailable exactly when the Who paid us bar is. While iOS or Android is selected it is never zero; with neither, it is a proven 0 when Web is not selected either or Stripe’s scans cover all of its days.</li>
        </>}
        countLabel="Events"
        unavailableBarText="Unavailable: no classified trial start, first payment or recurring payment is recorded."
        noAvailableBarText="No classified events are available in this range."
        loadReport={loadByProvider}
        formatValue={formatPaymentProvider}
        buildExtraNotes={null}
        keyLink={null}
      />
      <PaymentImportStatusSection
        config={props.config}
        dateRange={props.dateRange}
        period={props.period}
        onTerminalAdminError={props.onTerminalAdminError}
      />
    </>
  );
}
