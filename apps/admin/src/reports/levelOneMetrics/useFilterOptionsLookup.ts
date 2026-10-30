import { useEffect, useState } from "react";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsDateRange } from "../../filters/analyticsFilters";

export type FilterOptionsLookup<Options> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string; retry: () => void }>
  | Readonly<{ status: "ready"; options: Options }>;

/** One Level 1 bar's option list over the selected range; `loadOptions` must be stable, as a module-level loader is. */
export function useFilterOptionsLookup<Options>(
  config: AdminAppConfig,
  dateRange: AnalyticsDateRange,
  loadOptions: (config: AdminAppConfig, dateRange: AnalyticsDateRange, signal: AbortSignal) => Promise<Options>,
  unexpectedErrorMessage: string,
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean,
): FilterOptionsLookup<Options> {
  const [lookup, setLookup] = useState<FilterOptionsLookup<Options>>({ status: "loading" });
  const [revision, setRevision] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    setLookup({ status: "loading" });
    const abortController = new AbortController();
    void loadOptions(config, dateRange, abortController.signal).then((options) => {
      if (!cancelled) setLookup({ status: "ready", options });
    }).catch((error: unknown) => {
      if (cancelled || onTerminalAdminError(error, config)) return;
      setLookup({
        status: "error",
        message: error instanceof Error ? error.message : unexpectedErrorMessage,
        retry: () => setRevision((value) => value + 1),
      });
    });
    return () => { cancelled = true; abortController.abort(); };
  }, [config, dateRange, loadOptions, unexpectedErrorMessage, onTerminalAdminError, revision]);
  return lookup;
}
