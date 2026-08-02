import { Hono } from "hono";
import { listWorkspaceTagsSummary } from "../cards";
import {
  catalogPackageInstallOperationIdPrefixMaximumLength,
  installCatalogPackageVersion,
  isValidCatalogPackageInstallOperationIdPrefix,
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
  expectBoolean,
  expectRecord,
  expectUuidString,
  parseJsonBody,
} from "../server/requestParsing";
import { HttpError } from "../shared/errors";

export type CatalogInstallRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
  listWorkspaceTagsSummaryFn?: typeof listWorkspaceTagsSummary;
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

function parseCatalogPackageInstallOperationIdPrefix(value: unknown): string {
  if (
    typeof value === "string"
    && isValidCatalogPackageInstallOperationIdPrefix(value)
  ) {
    return value;
  }

  throw new HttpError(
    400,
    [
      "operationIdPrefix must be",
      `1 to ${catalogPackageInstallOperationIdPrefixMaximumLength}`,
      "printable ASCII characters without leading or trailing spaces.",
    ].join(" "),
    "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
  );
}

function parseCatalogPackageInstallConfirmInput(value: unknown): CatalogPackageInstallConfirmInput {
  const record = expectRecord(value);
  const addImportTag = record.addImportTag === undefined
    ? false
    : expectBoolean(record.addImportTag, "addImportTag");
  const importTag = record.importTag === undefined
    ? ""
    : parseCatalogPackageInstallImportTag(record.importTag);
  if (addImportTag && importTag.trim() === "") {
    throw new HttpError(
      400,
      "importTag must not be empty when addImportTag is true",
      "CATALOG_PACKAGE_INSTALL_INVALID_INPUT",
    );
  }

  return {
    installId: expectNonEmptyString(record.installId, "installId"),
    installedAt: expectNonEmptyString(record.installedAt, "installedAt"),
    clientUpdatedAt: expectNonEmptyString(record.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: expectUuidString(record.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    operationIdPrefix: parseCatalogPackageInstallOperationIdPrefix(record.operationIdPrefix),
    addImportTag,
    importTag,
    removeTags: parseCatalogPackageInstallRemoveTags(record.removeTags),
  };
}

function parseCatalogPackageInstallImportTag(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "importTag must be a string", "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
  }

  return value;
}

function parseCatalogPackageInstallRemoveTags(value: unknown): ReadonlyArray<string> {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value) === false) {
    throw new HttpError(400, "removeTags must be an array", "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
  }

  return value.map((tag, index) => expectNonEmptyString(tag, `removeTags[${index}]`));
}

export function createCatalogInstallRoutes(options: CatalogInstallRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;
  const listWorkspaceTagsSummaryFn = options.listWorkspaceTagsSummaryFn ?? listWorkspaceTagsSummary;
  const previewCatalogPackageInstallFn = options.previewCatalogPackageInstallFn ?? previewCatalogPackageInstall;
  const installCatalogPackageVersionFn = options.installCatalogPackageVersionFn ?? installCatalogPackageVersion;

  app.post("/workspaces/:workspaceId/catalog/package-versions/:packageVersionId/install/preview", async (context) => {
    const loadedContext = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const packageVersionId = parseCatalogPackageVersionIdParam(context.req.param("packageVersionId"));
    await assertUserHasWorkspaceAccessFn(loadedContext.requestContext.userId, workspaceId);
    const existingWorkspaceTags = (await listWorkspaceTagsSummaryFn(
      loadedContext.requestContext.userId,
      workspaceId,
    )).tags.map((tagSummary) => tagSummary.tag);
    const preview = await previewCatalogPackageInstallFn(
      loadedContext.requestContext.userId,
      workspaceId,
      packageVersionId,
      {
        generatedAt: new Date().toISOString(),
        existingWorkspaceTags,
      },
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
