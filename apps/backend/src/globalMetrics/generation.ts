import { generateGlobalMetricsSnapshot } from "./reporting";
import {
  writeGlobalMetricsSnapshotToS3,
  type GlobalMetricsSnapshotWriteResult,
} from "./storage";
import type { GlobalMetricsSnapshot } from "./snapshot";

type GenerateAndWriteGlobalMetricsSnapshotDependencies = Readonly<{
  generateGlobalMetricsSnapshotFn: () => Promise<GlobalMetricsSnapshot>;
  writeGlobalMetricsSnapshotToS3Fn: (
    snapshot: GlobalMetricsSnapshot,
  ) => Promise<GlobalMetricsSnapshotWriteResult>;
}>;

export async function generateAndWriteGlobalMetricsSnapshotWithDependencies(
  dependencies: GenerateAndWriteGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshotWriteResult> {
  const snapshot = await dependencies.generateGlobalMetricsSnapshotFn();
  return dependencies.writeGlobalMetricsSnapshotToS3Fn(snapshot);
}

export async function generateAndWriteGlobalMetricsSnapshot(): Promise<GlobalMetricsSnapshotWriteResult> {
  return generateAndWriteGlobalMetricsSnapshotWithDependencies({
    generateGlobalMetricsSnapshotFn: generateGlobalMetricsSnapshot,
    writeGlobalMetricsSnapshotToS3Fn: writeGlobalMetricsSnapshotToS3,
  });
}
