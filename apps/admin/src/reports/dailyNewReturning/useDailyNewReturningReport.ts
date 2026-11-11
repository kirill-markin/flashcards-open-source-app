import { useEffect, useState } from "react";
import type { ProductEventDeviceType, ReviewEventPlatform } from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import type { ReportPeriod } from "../levelOneMetrics/reportPeriod";

export type DailyNewReturningSelection = Readonly<{
  config: AdminAppConfig;
  dateRange: AnalyticsDateRange;
  period: ReportPeriod;
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>;
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>;
  appVersions: ReadonlyArray<string>;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

export type DailyNewReturningLoadState<Report> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: Report }>;

export type DailyNewReturningReportLoader<Report> = (
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  period: ReportPeriod,
  eventPlatforms: ReadonlyArray<ReviewEventPlatform>,
  eventDeviceTypes: ReadonlyArray<ProductEventDeviceType>,
  appVersions: ReadonlyArray<string>,
  reportLabel: string,
  signal: AbortSignal,
) => Promise<Report>;

export function useDailyNewReturningReport<Report>(
  selection: DailyNewReturningSelection,
  title: string,
  loadReport: DailyNewReturningReportLoader<Report>,
): Readonly<{ state: DailyNewReturningLoadState<Report>; retry: () => void }> {
  const { config, dateRange, period, eventPlatforms, eventDeviceTypes, appVersions, onTerminalAdminError } = selection;
  const [state, setState] = useState<DailyNewReturningLoadState<Report>>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const abortController = new AbortController();
    void loadReport(config, dateRange, period, eventPlatforms, eventDeviceTypes, appVersions, `${title} report`, abortController.signal).then((report) => {
      if (!cancelled) setState({ status: "ready", report });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setState({ status: "error", message: error instanceof Error ? error.message : `Unexpected ${title} query error.` });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [config, dateRange, period, eventPlatforms, eventDeviceTypes, appVersions, onTerminalAdminError, title, loadReport, revision]);
  return { state, retry: () => setRevision((value) => value + 1) };
}
