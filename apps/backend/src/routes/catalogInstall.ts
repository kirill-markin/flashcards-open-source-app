import { Hono } from "hono";
import {
  installCatalogPackageVersion,
  previewCatalogPackageInstall,
} from "../catalog";
import type {
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallPreview,
  CatalogPackageInstallResult,
} from "../catalog/types";
import { assertUserHasWorkspaceAccess } from "../workspaces";
import type { AppEnv } from "../server/app";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
  parseJsonBody,
} from "../server/requestParsing";
import { HttpError } from "../shared/errors";

export type CatalogInstallRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  previewCatalogPackageInstallFn?: typeof previewCatalogPackageInstall;
  installCatalogPackageVersionFn?: typeof installCatalogPackageVersion;
}>;

type CatalogPackageInstallPreviewResponse = CatalogPackageInstallPreview;
type CatalogPackageInstallConfirmResponse = CatalogPackageInstallResult;

function parseCatalogPackageVersionIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(
      400,
      "packageVersionId is required",
      "CATALOG_PACKAGE_INSTALL_PARAM_REQUIRED",
    );
  }

  try {
    return expectUuidString(value, "packageVersionId");
  } catch {
    throw new HttpError(
      400,
      "packageVersionId must be a UUID",
      "CATALOG_PACKAGE_INSTALL_PARAM_INVALID",
    );
  }
}

function parseCatalogPackageInstallConfirmInput(value: unknown): CatalogPackageInstallConfirmInput {
  const record = expectRecord(value);
  return {
    installId: expectNonEmptyString(record.installId, "installId"),
    installedAt: expectNonEmptyString(record.installedAt, "installedAt"),
    clientUpdatedAt: expectNonEmptyString(record.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: expectUuidString(record.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    operationIdPrefix: expectNonEmptyString(record.operationIdPrefix, "operationIdPrefix"),
  };
}

export function createCatalogInstallRoutes(options: CatalogInstallRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const previewCatalogPackageInstallFn = options.previewCatalogPackageInstallFn ?? previewCatalogPackageInstall;
  const installCatalogPackageVersionFn = options.installCatalogPackageVersionFn ?? installCatalogPackageVersion;

  app.post("/workspaces/:workspaceId/catalog/package-versions/:packageVersionId/install/preview", async (context) => {
    const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const packageVersionId = parseCatalogPackageVersionIdParam(context.req.param("packageVersionId"));
    await assertUserHasWorkspaceAccessFn(loadedContext.requestContext.userId, workspaceId);
    const preview = await previewCatalogPackageInstallFn(
      loadedContext.requestContext.userId,
      workspaceId,
      packageVersionId,
    );

    return context.json(preview satisfies CatalogPackageInstallPreviewResponse);
  });

  app.post("/workspaces/:workspaceId/catalog/package-versions/:packageVersionId/install", async (context) => {
    const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const packageVersionId = parseCatalogPackageVersionIdParam(context.req.param("packageVersionId"));
    await assertUserHasWorkspaceAccessFn(loadedContext.requestContext.userId, workspaceId);
    const input = parseCatalogPackageInstallConfirmInput(await parseJsonBody(context.req.raw));
    const result = await installCatalogPackageVersionFn(
      loadedContext.requestContext.userId,
      workspaceId,
      packageVersionId,
      input,
    );

    return context.json(result satisfies CatalogPackageInstallConfirmResponse);
  });

  return app;
}
