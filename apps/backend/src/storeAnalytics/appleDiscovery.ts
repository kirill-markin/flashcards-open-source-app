import type {
  AppStoreConnectClient,
  AnalyticsReport,
  AnalyticsReportInstance,
  AnalyticsReportRequest,
} from "./appStoreConnectClient";
import { resolveAppleReportVariant, type AppleReportVariant } from "./appleReports";

export type PendingInstance = Readonly<{
  report: AnalyticsReport;
  variant: AppleReportVariant;
  instance: AnalyticsReportInstance;
}>;

/** `/` separates the instance and segment ids inside `import_files.source_ref`. */
export function assertSourceRefId(id: string, kind: string): void {
  if (id.includes("/")) {
    throw new Error(`App Store Connect ${kind} id ${id} contains "/", which source_ref uses as its separator`);
  }
}

export async function listPendingInstances(
  client: AppStoreConnectClient,
  requests: ReadonlyArray<AnalyticsReportRequest>,
): Promise<Readonly<{ reports: number; listed: ReadonlyArray<PendingInstance> }>> {
  const reports: Array<AnalyticsReport> = [];
  for (const request of requests) {
    reports.push(...await client.listReports(request.id));
  }
  const listed: Array<ReadonlyArray<PendingInstance>> = new Array(reports.length);
  let nextIndex = 0;
  let failure: PromiseRejectedResult | undefined;
  async function listWorkerInstances(): Promise<void> {
    while (failure === undefined && nextIndex < reports.length) {
      const index = nextIndex++;
      const report = reports[index];
      try {
        const variant = resolveAppleReportVariant(report.name);
        const instances = await client.listInstances(report.id);
        listed[index] = instances.map((instance) => {
          assertSourceRefId(instance.id, "report instance");
          return { report, variant, instance };
        });
      } catch (reason) {
        failure ??= { status: "rejected", reason };
        throw reason;
      }
    }
  }
  // Keep the source lock until every admitted listing has settled, including on failure.
  await Promise.allSettled(Array.from({ length: Math.min(8, reports.length) }, listWorkerInstances));
  if (failure !== undefined) {
    throw failure.reason;
  }
  return { reports: reports.length, listed: listed.flat() };
}
