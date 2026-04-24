import { Hono } from "hono";
import type { AppEnv } from "../app";
import { HttpError } from "../errors";
import type { GlobalMetricsSnapshot } from "../globalMetrics/snapshot";
import {
  isGlobalMetricsVisible,
  loadGlobalMetricsSnapshotFromS3,
} from "../globalMetrics/storage";
import { logCloudRouteEvent } from "../server/logging";

export const globalSnapshotPath = "/global/snapshot";
const globalMetricsSnapshotUnavailableCode = "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE";
const globalMetricsSnapshotUnavailableMessage = "Global metrics snapshot is unavailable.";

type GlobalSnapshotRoutesOptions = Readonly<{
  loadGlobalMetricsSnapshotFn?: () => Promise<GlobalMetricsSnapshot>;
  isGlobalMetricsVisibleFn?: () => boolean;
}>;

function assertGlobalMetricsVisible(isVisible: boolean): void {
  if (!isVisible) {
    throw new HttpError(404, "Global metrics snapshot is not visible.", "GLOBAL_METRICS_NOT_VISIBLE");
  }
}

function applyGlobalSnapshotCorsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.delete("Access-Control-Allow-Credentials");
  return response;
}

function isGlobalMetricsSnapshotUnavailableError(error: unknown): error is HttpError {
  return error instanceof HttpError
    && error.statusCode === 503
    && error.code === globalMetricsSnapshotUnavailableCode;
}

export function createGlobalSnapshotRoutes(options: GlobalSnapshotRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadGlobalMetricsSnapshotFn = options.loadGlobalMetricsSnapshotFn ?? loadGlobalMetricsSnapshotFromS3;
  const isGlobalMetricsVisibleFn = options.isGlobalMetricsVisibleFn ?? isGlobalMetricsVisible;

  app.use(globalSnapshotPath, async (context, next) => {
    context.header("Access-Control-Allow-Origin", "*");
    context.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    try {
      await next();
    } finally {
      applyGlobalSnapshotCorsHeaders(context.res);
    }
  });

  app.get(globalSnapshotPath, async (context) => {
    assertGlobalMetricsVisible(isGlobalMetricsVisibleFn());
    try {
      const response = context.json(await loadGlobalMetricsSnapshotFn());
      return applyGlobalSnapshotCorsHeaders(response);
    } catch (error) {
      if (!isGlobalMetricsSnapshotUnavailableError(error)) {
        throw error;
      }

      logCloudRouteEvent("global_snapshot_error", {
        requestId: context.get("requestId"),
        route: context.req.path,
        statusCode: error.statusCode,
        code: error.code,
        storageErrorMessage: error.message,
      }, true);

      return applyGlobalSnapshotCorsHeaders(context.json({
        error: globalMetricsSnapshotUnavailableMessage,
        requestId: context.get("requestId"),
        code: globalMetricsSnapshotUnavailableCode,
      }, 503));
    }
  });

  return app;
}
