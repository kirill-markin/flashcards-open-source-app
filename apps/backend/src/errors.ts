export type ValidationIssueSummary = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type HttpErrorDetails = Readonly<{
  validationIssues: ReadonlyArray<ValidationIssueSummary>;
}>;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly details: HttpErrorDetails | null;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: HttpErrorDetails,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? null;
    this.details = details ?? null;
  }
}
