import { generateGlobalMetricsSnapshot } from "./reporting";
import {
  writeGlobalMetricsSnapshotToS3,
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
  return generateAndWriteGlobalMetricsSnapshotWithDependencies(observationScope, {
    generateGlobalMetricsSnapshotFn: generateGlobalMetricsSnapshot,
    writeGlobalMetricsSnapshotToS3Fn: writeGlobalMetricsSnapshotToS3,
  });
}
