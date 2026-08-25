import { parsePublicOrigin } from "../../../shared/publicUrls";
import type { BackendObservationScope } from "../../../observability/sentry";
import { loadPublicCatalogSnapshot } from "./snapshot";
import { writeCatalogDumpToS3, type CatalogDumpWriteResult } from "./dumpStorage";

function getRequiredCatalogDumpEnv(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${envName} is required for the public catalog dump.`);
  }

  return value.trim();
}

/**
 * Builds the snapshot the public catalog dump publishes. The builder runs without
 * an HTTP request, so both public base URLs come from the environment instead of
 * the request URL the `GET /v1/catalog` route resolves them from.
 */
export async function generateAndWriteCatalogDump(
  observationScope: BackendObservationScope,
): Promise<CatalogDumpWriteResult> {
  const configuredApiBaseUrl = getRequiredCatalogDumpEnv("PUBLIC_API_BASE_URL");
  const publicApiBaseUrl = configuredApiBaseUrl.endsWith("/")
    ? configuredApiBaseUrl.slice(0, -1)
    : configuredApiBaseUrl;
  const publicAppBaseUrl = parsePublicOrigin(
    getRequiredCatalogDumpEnv("PUBLIC_APP_BASE_URL"),
    "PUBLIC_APP_BASE_URL",
  );
  const snapshot = await loadPublicCatalogSnapshot(publicApiBaseUrl, publicAppBaseUrl);
  return writeCatalogDumpToS3(observationScope, snapshot);
}
