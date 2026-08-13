import { isIndexedDbOpenRecoveryError } from "../localDb/core/indexedDbOpenRecovery";
import { normalizeCaughtError } from "../observability/webObservability";

type DismissAppErrorAction = Readonly<{
  kind: "dismiss";
  label: string;
}>;

type ReloadPageAppErrorAction = Readonly<{
  kind: "reload-page";
  label: string;
}>;

export type AppErrorAction = DismissAppErrorAction | ReloadPageAppErrorAction;

type TechnicalErrorPresentation = Readonly<{
  kind: "technical-error";
  title: string;
  message: string;
  technicalDetails: string;
  action: DismissAppErrorAction;
}>;

type IndexedDbReloadRecoveryPresentation = Readonly<{
  kind: "indexeddb-reload-recovery";
  title: string;
  message: string;
  guidance: string;
  technicalDetails: string;
  action: ReloadPageAppErrorAction;
  dismissLabel: string;
}>;

export type AppErrorPresentation = TechnicalErrorPresentation | IndexedDbReloadRecoveryPresentation;

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
  technicalError: Readonly<{
    title: string;
    message: string;
    close: string;
  }>;
  indexedDbReloadRecovery: Readonly<{
    title: string;
    message: string;
    guidance: string;
    reload: string;
    later: string;
  }>;
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
  const technicalDetails = buildTechnicalDetails(error, messages.labels);

  if (isIndexedDbOpenRecoveryError(error)) {
    return {
      kind: "indexeddb-reload-recovery",
      title: messages.indexedDbReloadRecovery.title,
      message: messages.indexedDbReloadRecovery.message,
      guidance: messages.indexedDbReloadRecovery.guidance,
      technicalDetails,
      action: {
        kind: "reload-page",
        label: messages.indexedDbReloadRecovery.reload,
      },
      dismissLabel: messages.indexedDbReloadRecovery.later,
    };
  }

  return {
    kind: "technical-error",
    title: messages.technicalError.title,
    message: messages.technicalError.message,
    technicalDetails,
    action: {
      kind: "dismiss",
      label: messages.technicalError.close,
    },
  };
}
