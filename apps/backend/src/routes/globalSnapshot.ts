import { Hono } from "hono";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import type { GlobalMetricsSnapshotV3 } from "../globalMetrics/snapshotV3";
import type { GlobalMetricsSnapshot } from "../globalMetrics/snapshot";
import {
  isGlobalMetricsVisible,
  loadGlobalMetricsSnapshotFromS3,
  loadGlobalMetricsSnapshotV3FromS3,
} from "../globalMetrics/storage";
import {
  captureBackendWarning,
  createBackendObservationScope,
  type BackendObservationScope,
} from "../observability/sentry";

export const globalSnapshotPath = "/global/snapshot";
const globalMetricsSnapshotUnavailableCode = "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE";
const globalMetricsSnapshotUnavailableMessage = "Global metrics snapshot is unavailable.";

type GlobalSnapshotRoutesOptions = Readonly<{
  loadGlobalMetricsSnapshotFn?: (observationScope: BackendObservationScope) => Promise<GlobalMetricsSnapshot>;
  loadGlobalMetricsSnapshotV3Fn?: (observationScope: BackendObservationScope) => Promise<GlobalMetricsSnapshotV3>;
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
  const loadGlobalMetricsSnapshotV3Fn = options.loadGlobalMetricsSnapshotV3Fn ?? loadGlobalMetricsSnapshotV3FromS3;
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
    const versions = context.req.queries("schemaVersion");
    const schemaVersion = versions?.[0];
    if (
      (versions !== undefined && versions.length !== 1)
      || (schemaVersion !== undefined && schemaVersion !== "2" && schemaVersion !== "3")
    ) {
      throw new HttpError(400, "schemaVersion must be 2 or 3, specified once.", "INVALID_GLOBAL_METRICS_SCHEMA_VERSION");
    }
    const observationScope = createBackendObservationScope(
      "backend-api",
      context.get("requestId"),
      context.req.path,
      context.req.method,
      null,
      null,
      null,
      null,
      null,
      context.get("clientAppVersion") ?? null,
      context.get("clientPlatform") ?? null,
    );
    try {
      const snapshot = schemaVersion === "3"
        ? await loadGlobalMetricsSnapshotV3Fn(observationScope)
        : await loadGlobalMetricsSnapshotFn(observationScope);
      const response = context.json(snapshot);
      return applyGlobalSnapshotCorsHeaders(response);
    } catch (error) {
      if (!isGlobalMetricsSnapshotUnavailableError(error)) {
        throw error;
      }

      captureBackendWarning({
        action: "global_snapshot_error",
        message: "Global metrics snapshot is unavailable.",
        scope: observationScope,
        details: {
          statusCode: error.statusCode,
          code: error.code,
          storageErrorMessage: error.message,
        },
      });

      return applyGlobalSnapshotCorsHeaders(context.json({
        error: globalMetricsSnapshotUnavailableMessage,
        requestId: context.get("requestId"),
        code: globalMetricsSnapshotUnavailableCode,
      }, 503));
    }
  });

  return app;
}
