export type ApiResponseBodyKind = "empty" | "json" | "text" | "invalid_json";

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

export class AuthRedirectError extends Error {
  readonly redirectUrl: string;

  constructor(redirectUrl: string) {
    super("Browser session expired. Redirecting to sign in.");
    this.redirectUrl = redirectUrl;
  }
}
