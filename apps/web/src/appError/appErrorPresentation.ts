import { normalizeCaughtError } from "../observability/webObservability";

export type AppErrorPresentation = Readonly<{
  title: string;
  message: string;
  technicalDetails: string;
}>;

export type AppErrorPresentationLabels = Readonly<{
  name: string;
  message: string;
  endpoint: string;
  requestId: string;
  statusCode: string;
  code: string;
  bodyKind: string;
  attemptCount: string;
  originalErrorName: string;
  unavailable: string;
}>;

export type AppErrorPresentationMessages = Readonly<{
  title: string;
  message: string;
  labels: AppErrorPresentationLabels;
}>;

type ErrorMetadataCarrier = Readonly<{
  endpoint?: unknown;
  requestId?: unknown;
  statusCode?: unknown;
  code?: unknown;
  responseBodyKind?: unknown;
  attemptCount?: unknown;
  originalErrorName?: unknown;
}>;

type TechnicalDetailEntry = Readonly<{
  label: string;
  value: string;
}>;

function readStringMetadata(error: Error, key: keyof ErrorMetadataCarrier): string | null {
  const metadataValue = (error as ErrorMetadataCarrier)[key];

  return typeof metadataValue === "string" && metadataValue.trim() !== "" ? metadataValue : null;
}

function readNumberMetadata(error: Error, key: keyof ErrorMetadataCarrier): number | null {
  const metadataValue = (error as ErrorMetadataCarrier)[key];

  return typeof metadataValue === "number" && Number.isFinite(metadataValue) ? metadataValue : null;
}

function buildRequiredDetailEntry(label: string, value: string, unavailable: string): TechnicalDetailEntry {
  const trimmedValue = value.trim();

  return {
    label,
    value: trimmedValue === "" ? unavailable : trimmedValue,
  };
}

function buildOptionalStringDetailEntry(
  label: string,
  value: string | null,
): TechnicalDetailEntry | null {
  return value === null ? null : { label, value };
}

function buildOptionalNumberDetailEntry(
  label: string,
  value: number | null,
): TechnicalDetailEntry | null {
  return value === null ? null : { label, value: String(value) };
}

function formatTechnicalDetailEntry(entry: TechnicalDetailEntry): string {
  return `${entry.label}: ${entry.value}`;
}

function buildTechnicalDetails(error: Error, labels: AppErrorPresentationLabels): string {
  const entries: ReadonlyArray<TechnicalDetailEntry | null> = [
    buildRequiredDetailEntry(labels.name, error.name, labels.unavailable),
    buildRequiredDetailEntry(labels.message, error.message, labels.unavailable),
    buildOptionalStringDetailEntry(labels.endpoint, readStringMetadata(error, "endpoint")),
    buildOptionalStringDetailEntry(labels.requestId, readStringMetadata(error, "requestId")),
    buildOptionalNumberDetailEntry(labels.statusCode, readNumberMetadata(error, "statusCode")),
    buildOptionalStringDetailEntry(labels.code, readStringMetadata(error, "code")),
    buildOptionalStringDetailEntry(labels.bodyKind, readStringMetadata(error, "responseBodyKind")),
    buildOptionalNumberDetailEntry(labels.attemptCount, readNumberMetadata(error, "attemptCount")),
    buildOptionalStringDetailEntry(labels.originalErrorName, readStringMetadata(error, "originalErrorName")),
  ];

  return entries
    .filter((entry): entry is TechnicalDetailEntry => entry !== null)
    .map(formatTechnicalDetailEntry)
    .join("\n");
}

export function buildAppErrorPresentation(
  caughtError: unknown,
  messages: AppErrorPresentationMessages,
): AppErrorPresentation {
  const error = normalizeCaughtError(caughtError);

  return {
    title: messages.title,
    message: messages.message,
    technicalDetails: buildTechnicalDetails(error, messages.labels),
  };
}
