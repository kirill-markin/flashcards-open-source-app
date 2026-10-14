import { generateGlobalMetricsSnapshot } from "./reporting";
import { generateGlobalMetricsSnapshotV3 } from "./reportingV3";
import {
  writeGlobalMetricsSnapshotToS3,
  writeGlobalMetricsSnapshotV3ToS3,
  type GlobalMetricsSnapshotWriteResult,
} from "./storage";
import type { GlobalMetricsSnapshot } from "./snapshot";
import { getDatabaseErrorFields } from "../database/transient";
import {
  addBackendBreadcrumb,
  type BackendObservationScope,
} from "../observability/sentry";

type GenerateAndWriteGlobalMetricsSnapshotDependencies = Readonly<{
  generateGlobalMetricsSnapshotFn: () => Promise<GlobalMetricsSnapshot>;
  writeGlobalMetricsSnapshotToS3Fn: (
    observationScope: BackendObservationScope,
    snapshot: GlobalMetricsSnapshot,
  ) => Promise<GlobalMetricsSnapshotWriteResult>;
}>;

function logGlobalMetricsSnapshotVersionFailure(
  observationScope: BackendObservationScope,
  snapshotVersion: "v2" | "v3",
  error: unknown,
): void {
  const { sqlState, errorCode } = getDatabaseErrorFields(error);
  addBackendBreadcrumb({
    action: "global_metrics_snapshot_version_failed",
    scope: observationScope,
    details: {
      snapshotVersion,
      sqlState: sqlState !== null && /^[A-Z0-9]{5}$/u.test(sqlState) ? sqlState : null,
      errorCode: errorCode !== null && /^[A-Za-z0-9_]{1,64}$/u.test(errorCode) ? errorCode : null,
    },
  });
}

export async function generateAndWriteGlobalMetricsSnapshotWithDependencies(
  observationScope: BackendObservationScope,
  dependencies: GenerateAndWriteGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshotWriteResult> {
  const snapshot = await dependencies.generateGlobalMetricsSnapshotFn();
  return dependencies.writeGlobalMetricsSnapshotToS3Fn(observationScope, snapshot);
}

export async function generateAndWriteGlobalMetricsSnapshot(
  observationScope: BackendObservationScope,
): Promise<GlobalMetricsSnapshotWriteResult> {
  const [v2Result, v3Result] = await Promise.allSettled([
    generateAndWriteGlobalMetricsSnapshotWithDependencies(observationScope, {
      generateGlobalMetricsSnapshotFn: generateGlobalMetricsSnapshot,
      writeGlobalMetricsSnapshotToS3Fn: writeGlobalMetricsSnapshotToS3,
    }),
    generateGlobalMetricsSnapshotV3().then((snapshot) => (
      writeGlobalMetricsSnapshotV3ToS3(observationScope, snapshot)
    )),
  ]);

  if (v2Result.status === "rejected") {
    logGlobalMetricsSnapshotVersionFailure(observationScope, "v2", v2Result.reason);
  }
  if (v3Result.status === "rejected") {
    logGlobalMetricsSnapshotVersionFailure(observationScope, "v3", v3Result.reason);
  }

  if (v2Result.status === "rejected" && v3Result.status === "rejected") {
    throw new AggregateError(
      [v2Result.reason, v3Result.reason],
      "Failed to generate or write both v2 and v3 global metrics snapshots.",
    );
  }
  if (v2Result.status === "rejected") {
    throw v2Result.reason;
  }
  if (v3Result.status === "rejected") {
    throw v3Result.reason;
  }

  return v2Result.value;
}
