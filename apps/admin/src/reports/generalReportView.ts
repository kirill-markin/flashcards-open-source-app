/**
 * One report of the General batch as its section receives it. Charts draw only a ready report and
 * hold placeholders while the batch loads or reloads; summary cards keep the last loaded numbers,
 * none before the first load.
 */
export type GeneralReportView<Report> =
  | Readonly<{ status: "loading"; lastLoadedReport: Report | null }>
  | Readonly<{ status: "ready"; report: Report }>;

export function getLatestGeneralReport<Report>(view: GeneralReportView<Report>): Report | null {
  return view.status === "ready" ? view.report : view.lastLoadedReport;
}
