export type ApiResponseBodyKind = "empty" | "json" | "text" | "invalid_json";
export const apiNetworkErrorCode: string = "API_NETWORK_ERROR";

type ApiErrorParams = Readonly<{
  statusCode: number;
  message: string;
  code: string | null;
  requestId: string | null;
  endpoint: string;
  responseBodyKind: ApiResponseBodyKind;
}>;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly endpoint: string;
  readonly responseBodyKind: ApiResponseBodyKind;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.requestId = params.requestId;
    this.endpoint = params.endpoint;
    this.responseBodyKind = params.responseBodyKind;
  }
}

type ApiNetworkErrorParams = Readonly<{
  endpoint: string;
  originalErrorName: string;
  originalErrorMessage: string;
  attemptCount: number;
}>;

export class ApiNetworkError extends ApiError {
  readonly originalErrorName: string;
  readonly originalErrorMessage: string;
  readonly attemptCount: number;

  constructor(params: ApiNetworkErrorParams) {
    super({
      statusCode: 0,
      message: `The API is unavailable. Try again. (${params.endpoint}; ${params.originalErrorName}: ${params.originalErrorMessage})`,
      code: apiNetworkErrorCode,
      requestId: null,
      endpoint: params.endpoint,
      responseBodyKind: "empty",
    });
    this.name = "ApiNetworkError";
    this.originalErrorName = params.originalErrorName;
    this.originalErrorMessage = params.originalErrorMessage;
    this.attemptCount = params.attemptCount;
  }
}

export class AuthRedirectError extends Error {
  readonly redirectUrl: string;

  constructor(redirectUrl: string) {
    super("Browser session expired. Redirecting to sign in.");
    this.redirectUrl = redirectUrl;
  }
}
