import type { BarFreshness } from "../levelOneMetrics/breakdownReport";
import type { ReportBucket } from "../levelOneMetrics/reportPeriod";
import { formatCalendarDate, parseCalendarDate } from "../reportValues";
import type { StoreDelivery, WhoSawUsStoreSeriesKey } from "./query";

/**
 * How many days back from today UTC a store's numbers can still arrive or change.
 * App Store: Apple calls a day complete two days after it, and our import lands day D on D+3 around
 * 18:20 UTC. Google Play: Google posts daily data within 3 to 7 days.
 */
export const storeNotFinalDayCounts: Readonly<Record<WhoSawUsStoreSeriesKey, number>> = {
  "app-store": 3,
  "google-play": 7,
};

function buildDateDaysBefore(date: string, dayCount: number): string {
  const parsedDate = parseCalendarDate(date, "Store data freshness");
  return formatCalendarDate(new Date(Date.UTC(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate() - dayCount,
  )));
}

/**
 * Not arrived while the store has delivered none of the bar's days; not final while the bar's last day
 * is inside the store's window or past its newest delivered day, as in a partly delivered week.
 */
export function getStoreBarFreshness(
  store: WhoSawUsStoreSeriesKey,
  delivery: StoreDelivery,
  bucket: ReportBucket,
): BarFreshness {
  const newestDeliveredDate = delivery.newestDeliveredDateByStore[store];
  if (newestDeliveredDate === null || bucket.from > newestDeliveredDate) {
    return "not-arrived";
  }

  const lastFinalDate = buildDateDaysBefore(delivery.today, storeNotFinalDayCounts[store]);
  return bucket.to > lastFinalDate || bucket.to > newestDeliveredDate ? "not-final" : "final";
}
