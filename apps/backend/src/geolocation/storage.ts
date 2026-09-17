import { setTimeout } from "node:timers/promises";

export async function runGeoLiteStorageOperation<Result>(
  operation: "download" | "publish",
  run: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(JSON.stringify({
        action: "geolite_storage_retry",
        operation,
        attempt,
        errorClass: error instanceof Error ? error.name : "NonErrorRejection",
      }));
      await setTimeout(attempt * 250);
    }
  }
}
