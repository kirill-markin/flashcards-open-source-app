import type { Handler } from "aws-lambda";
import { generateAndWriteGlobalMetricsSnapshot } from "./globalMetrics/generation";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();

export const handler: Handler<
  unknown,
  Readonly<{
    ok: true;
    bucketName: string;
    objectKey: string;
    generatedAtUtc: string;
    asOfUtc: string;
    from: string;
    to: string;
  }>
> = async () => {
  const result = await generateAndWriteGlobalMetricsSnapshot();

  console.log(JSON.stringify({
    domain: "backend",
    action: "global_metrics_snapshot_generated",
    bucketName: result.bucketName,
    objectKey: result.objectKey,
    generatedAtUtc: result.snapshot.generatedAtUtc,
    asOfUtc: result.snapshot.asOfUtc,
    from: result.snapshot.from,
    to: result.snapshot.to,
    uniqueReviewingUsers: result.snapshot.totals.uniqueReviewingUsers,
    reviewEvents: result.snapshot.totals.reviewEvents.total,
  }));

  return {
    ok: true,
    bucketName: result.bucketName,
    objectKey: result.objectKey,
    generatedAtUtc: result.snapshot.generatedAtUtc,
    asOfUtc: result.snapshot.asOfUtc,
    from: result.snapshot.from,
    to: result.snapshot.to,
  };
};
