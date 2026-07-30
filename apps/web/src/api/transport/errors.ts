export type ApiResponseBodyKind = "empty" | "json" | "text" | "invalid_json";
export const apiNetworkErrorCode: string = "API_NETWORK_ERROR";

type ApiErrorParams = Readonly<{
  statusCode: number;
  message: string;
  code: string | null;
  requestId: string | null;
  retryAfterMs: number | null;
  endpoint: string;
  responseBodyKind: ApiResponseBodyKind;
}>;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;
  readonly endpoint: string;
  readonly responseBodyKind: ApiResponseBodyKind;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.requestId = params.requestId;
    this.retryAfterMs = params.retryAfterMs;
    this.endpoint = params.endpoint;
    this.responseBodyKind = params.responseBodyKind;
  }
}

type ApiNetworkErrorParams = Readonly<{
  statusCode: number;
  requestId: string | null;
  responseBodyKind: ApiResponseBodyKind;
  endpoint: string;
  originalErrorName: string;
  originalErrorMessage: string;
  attemptCount: number;
  source: "fetch" | "response_body";
}>;

type ApiNetworkErrorCauseParams = Omit<
  ApiNetworkErrorParams,
  "originalErrorName" | "originalErrorMessage"
> & Readonly<{
  error: unknown;
}>;

export class ApiNetworkError extends ApiError {
  readonly originalErrorName: string;
  readonly originalErrorMessage: string;
  readonly attemptCount: number;
  readonly source: ApiNetworkErrorParams["source"];

  constructor(params: ApiNetworkErrorParams) {
    super({
      statusCode: params.statusCode,
      message: `The API is unavailable. Try again. (${params.endpoint}; ${params.originalErrorName}: ${params.originalErrorMessage})`,
      code: apiNetworkErrorCode,
      requestId: params.requestId,
      retryAfterMs: null,
      endpoint: params.endpoint,
      responseBodyKind: params.responseBodyKind,
    });
    this.name = "ApiNetworkError";
    this.originalErrorName = params.originalErrorName;
    this.originalErrorMessage = params.originalErrorMessage;
    this.attemptCount = params.attemptCount;
    this.source = params.source;
  }
}

function readOriginalErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== "") {
    return error.name;
  }

  return typeof error;
}

function readOriginalErrorMessage(
  error: unknown,
  source: ApiNetworkErrorParams["source"],
): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  const errorMessage = String(error);
  if (errorMessage.trim() !== "") {
    return errorMessage;
  }

  return source === "fetch"
    ? "Unknown fetch failure"
    : "Unknown response body read failure";
}

export function createApiNetworkError(params: ApiNetworkErrorCauseParams): ApiNetworkError {
  return new ApiNetworkError({
    statusCode: params.statusCode,
    requestId: params.requestId,
    responseBodyKind: params.responseBodyKind,
    endpoint: params.endpoint,
    originalErrorName: readOriginalErrorName(params.error),
    originalErrorMessage: readOriginalErrorMessage(params.error, params.source),
    attemptCount: params.attemptCount,
    source: params.source,
  });
}

export class AuthRedirectError extends Error {
  readonly redirectUrl: string;

  constructor(redirectUrl: string) {
    super("Browser session expired. Redirecting to sign in.");
    this.redirectUrl = redirectUrl;
  }
}
