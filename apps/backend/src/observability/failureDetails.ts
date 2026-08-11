import { AuthError } from "../auth";
import {
  HttpError,
  type CatalogImageBlobErrorDetails,
  type MediaAssetStorageErrorDetails,
} from "../shared/errors";

export type BackendValidationIssueDetail = Readonly<{
  path: string;
  code: string;
}>;

export type BackendFailureDetails = Readonly<{
  statusCode: number;
  code: string | null;
  message: string | null;
  validationIssues: ReadonlyArray<BackendValidationIssueDetail>;
  mediaAssetStorage?: MediaAssetStorageErrorDetails;
  catalogImageBlob?: CatalogImageBlobErrorDetails;
}>;

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRequestErrorStatusCode(error: AuthError | HttpError | unknown): number {
  if (error instanceof AuthError || error instanceof HttpError) {
    return error.statusCode;
  }

  return 500;
}

function getRequestErrorCode(error: AuthError | HttpError | unknown): string | null {
  if (error instanceof AuthError) {
    return "AUTH_UNAUTHORIZED";
  }

  if (error instanceof HttpError) {
    return error.code;
  }

  return "INTERNAL_ERROR";
}

function getMediaAssetStorageErrorDetails(
  error: AuthError | HttpError | unknown,
): MediaAssetStorageErrorDetails | undefined {
  if (error instanceof HttpError) {
    return error.details?.mediaAssetStorage;
  }

  return undefined;
}

function getCatalogImageBlobErrorDetails(
  error: AuthError | HttpError | unknown,
): CatalogImageBlobErrorDetails | undefined {
  if (error instanceof HttpError) {
    return error.details?.catalogImageBlob;
  }

  return undefined;
}

export function createBackendFailureDetails(
  error: AuthError | HttpError | unknown,
): BackendFailureDetails {
  const mediaAssetStorage = getMediaAssetStorageErrorDetails(error);
  const catalogImageBlob = getCatalogImageBlobErrorDetails(error);
  return {
    statusCode: getRequestErrorStatusCode(error),
    code: getRequestErrorCode(error),
    message: getInternalErrorMessage(error),
    validationIssues: summarizeValidationIssues(error),
    ...(mediaAssetStorage === undefined ? {} : { mediaAssetStorage }),
    ...(catalogImageBlob === undefined ? {} : { catalogImageBlob }),
  };
}

export function summarizeValidationIssues(
  error: HttpError | unknown,
): ReadonlyArray<BackendValidationIssueDetail> {
  if (!(error instanceof HttpError)) {
    return [];
  }

  const validationIssues = error.details?.validationIssues ?? [];
  return validationIssues.map((issue) => ({
    path: issue.path,
    code: issue.code,
  }));
}
