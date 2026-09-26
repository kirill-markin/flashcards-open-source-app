import { generateGlobalMetricsSnapshot } from "./reporting";
import { generateGlobalMetricsSnapshotV3 } from "./reportingV3";
import {
  writeGlobalMetricsSnapshotToS3,
  writeGlobalMetricsSnapshotV3ToS3,
  type GlobalMetricsSnapshotWriteResult,
} from "./storage";
import type { GlobalMetricsSnapshot } from "./snapshot";
import type { BackendObservationScope } from "../observability/sentry";

type GenerateAndWriteGlobalMetricsSnapshotDependencies = Readonly<{
  generateGlobalMetricsSnapshotFn: () => Promise<GlobalMetricsSnapshot>;
  writeGlobalMetricsSnapshotToS3Fn: (
    observationScope: BackendObservationScope,
    snapshot: GlobalMetricsSnapshot,
  ) => Promise<GlobalMetricsSnapshotWriteResult>;
}>;

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
