import type { JSX } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { BreakdownSection } from "../levelOneMetrics/BreakdownSection";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";
import { PaymentImportStatusSection } from "./PaymentImportStatusSection";
import { formatPaymentProvider, loadWhoPaidUsProviderBreakdownReport } from "./providerBreakdown";

/** The Who paid us Details sections: the provider breakdown beside the chart, then the payment import status. */
export function WhoPaidUsBreakdownSections(props: Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>): JSX.Element {
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
          <li>Apple and Google merchant history is partial, so counts are partial and cannot prove zero. A bar with no recorded classified trial start, first payment or recurring payment is unavailable, never zero, exactly when the Who paid us bar is.</li>
        </>}
        countLabel="Events"
        unavailableBarText="Unavailable: no classified trial start, first payment or recurring payment is recorded."
        noAvailableBarText="No classified events are available in this range."
        loadReport={loadWhoPaidUsProviderBreakdownReport}
        formatValue={formatPaymentProvider}
        buildExtraNotes={null}
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
