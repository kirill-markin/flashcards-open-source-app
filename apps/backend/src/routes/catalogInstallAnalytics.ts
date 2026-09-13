import { Hono } from "hono";
import { createBackendFailureDetails } from "../server/logging";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import {
  parseCatalogInstallJourneyEvent,
} from "../productAnalytics/catalogJourney";
import { insertProductAnalyticsEvents } from "../productAnalytics/writer";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
import type { ProductAnalyticsEventRow } from "../productAnalytics/types";
import type { AppEnv } from "../server/app";

type CatalogInstallAnalyticsResponse = Readonly<{
  accepted: true;
}>;

type CatalogInstallAnalyticsRouteOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

const catalogInstallAnalyticsBodyMaximumBytes = 8 * 1024;

function assertCatalogInstallAnalyticsOrigin(
  headers: Headers,
  allowedOrigins: ReadonlyArray<string>,
): void {
  const origin = headers.get("origin");
  if (origin !== null && allowedOrigins.includes(origin) === false) {
    throw new HttpError(
      403,
      "Origin is not allowed for catalog install analytics.",
      "CATALOG_INSTALL_ANALYTICS_ORIGIN_NOT_ALLOWED",
    );
  }
}

function assertCatalogInstallAnalyticsContentType(headers: Headers): void {
  const contentTypeHeader = headers.get("content-type");
  const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json") {
    throw new HttpError(
      415,
      "content-type must be application/json",
      "CATALOG_INSTALL_ANALYTICS_CONTENT_TYPE_UNSUPPORTED",
    );
  }
}

function hasTrailingSlashRequestPath(request: Request): boolean {
  return new URL(request.url).pathname.endsWith("/");
}

function createCatalogInstallAnalyticsScope(
  requestId: string,
  path: string,
  method: string,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    path,
    method,
    null,
    null,
    null,
    null,
    null,
    null,
    "web",
  );
}

export function createCatalogInstallAnalyticsRoutes(
  options: CatalogInstallAnalyticsRouteOptions,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/analytics/catalog-install-events", async (context) => {
    if (hasTrailingSlashRequestPath(context.req.raw)) {
      throw new HttpError(
        404,
        "Not found. Post catalog install analytics to /v1/analytics/catalog-install-events without a trailing slash.",
        "CATALOG_INSTALL_ANALYTICS_ROUTE_NOT_FOUND",
      );
    }

    const requestId = context.get("requestId");
    const scope = createCatalogInstallAnalyticsScope(
      requestId,
      context.req.path,
      context.req.method,
    );
    let row: ProductAnalyticsEventRow | null = null;

    try {
      assertCatalogInstallAnalyticsOrigin(context.req.raw.headers, options.allowedOrigins);
      assertCatalogInstallAnalyticsContentType(context.req.raw.headers);
      const body = await parseJsonBodyWithByteLimit(
        context.req.raw,
        catalogInstallAnalyticsBodyMaximumBytes,
        "Catalog install analytics event is too large.",
        "CATALOG_INSTALL_ANALYTICS_BODY_TOO_LARGE",
      );
      const serverReceivedAt = new Date();
      row = parseCatalogInstallJourneyEvent(body, serverReceivedAt, requestId);
      const storedCount = await insertProductAnalyticsEvents([row]);
      addBackendBreadcrumb({
        action: "analytics_events_ingest",
        scope,
        details: {
          statusCode: 200,
          authTransport: "none",
          trustLevel: "anonymous_client",
          platform: "web",
          appVersion: null,
          eventCount: 1,
          acceptedCount: 1,
          rejectedCount: 0,
          outOfWindowCount: 0,
          contractRejectedCount: 0,
          storedCount,
          identityLinked: null,
        },
      });

      return context.json({ accepted: true } satisfies CatalogInstallAnalyticsResponse);
    } catch (error) {
      const isOutOfWindow = error instanceof HttpError
        && error.code === "CATALOG_INSTALL_ANALYTICS_EVENT_TIME_INVALID";
      const details = {
        authTransport: "none",
        trustLevel: "anonymous_client",
        platform: "web",
        appVersion: null,
        eventCount: row === null ? null : 1,
        acceptedCount: row === null ? null : 1,
        rejectedCount: row === null ? 1 : 0,
        outOfWindowCount: isOutOfWindow ? 1 : 0,
        contractRejectedCount: row === null && isOutOfWindow === false ? 1 : 0,
        storedCount: null,
        identityLinked: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "analytics_events_ingest_error", error: normalizeCaughtError(error), scope, details },
        { action: "analytics_events_ingest_error", scope, details },
      );
      throw error;
    }
  });

  return app;
}
