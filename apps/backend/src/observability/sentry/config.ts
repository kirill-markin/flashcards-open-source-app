import * as Sentry from "@sentry/aws-serverless";
import { cutHeadAtCodePoint } from "../../shared/codePointCuts";
import type { BackendService } from "./events";
import {
  sanitizeSentryEvent,
  sanitizeSentrySpan,
} from "./redaction";

type InitializeBackendSentryDependencies = Readonly<{
  init: (options: BackendSentryInitOptions) => void;
}>;

type BackendSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BackendSentryIntegrationFactory = NonNullable<
  Exclude<BackendSentryInitOptions["integrations"], ReadonlyArray<unknown> | undefined>
>;
type BackendSentryIntegration = Parameters<BackendSentryIntegrationFactory>[0][number];
type BackendSentryBeforeBreadcrumb = NonNullable<BackendSentryInitOptions["beforeBreadcrumb"]>;
type BackendSentryBreadcrumb = Parameters<BackendSentryBeforeBreadcrumb>[0];
type BackendSentryBreadcrumbHint = Parameters<BackendSentryBeforeBreadcrumb>[1];
type BackendSentryBreadcrumbData = NonNullable<BackendSentryBreadcrumb["data"]>;

type BackendSentryConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
    enabled: true;
    dsn: string;
    environment: string;
    release: string;
    tracesSampleRate: number;
  }>;

const initializedServices = new Set<BackendService>();
const disabledDefaultIntegrationNames = new Set<string>(["Postgres", "OpenAI", "Hono"]);
const consoleBreadcrumbCategory = "console";
const backendLogRecordDomain = "backend";
// The SDK keeps the latest 100 breadcrumbs, cuts each `message` only at 2048 characters and leaves
// every `data` string uncut, and an `agent_sql` record reaches Sentry with its SQL and error message
// three times (explicit breadcrumb data, the restored console message, the console `arguments`).
// At this cap a full trail of failing-SQL breadcrumbs stays under Sentry's 1 MB event limit even
// for multi-byte text, with little headroom: re-measure before raising it. CloudWatch keeps the full value.
const maximumSentryBreadcrumbStringChars = 1_000;
const sentryBreadcrumbTruncationMarker = "...[truncated]";

let currentBackendService: BackendService | null = null;

function isAwsLambdaRuntime(env: NodeJS.ProcessEnv): boolean {
  return (env.AWS_EXECUTION_ENV ?? "").startsWith("AWS_Lambda_")
    || (env.AWS_LAMBDA_FUNCTION_NAME ?? "") !== "";
}

function readRequiredSentryValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when backend Sentry is enabled`);
  }

  return value.trim();
}

function parseTraceSampleRate(rawValue: string): number {
  const tracesSampleRate = Number.parseFloat(rawValue);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1");
  }

  return tracesSampleRate;
}

export function getBackendSentryConfig(env: NodeJS.ProcessEnv): BackendSentryConfig {
  const dsn = env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === "") {
    if (isAwsLambdaRuntime(env)) {
      throw new Error("SENTRY_DSN is required in AWS Lambda backend runtimes");
    }

    return { enabled: false };
  }

  return {
    enabled: true,
    dsn: dsn.trim(),
    environment: readRequiredSentryValue(env, "SENTRY_ENVIRONMENT"),
    release: readRequiredSentryValue(env, "SENTRY_RELEASE"),
    tracesSampleRate: parseTraceSampleRate(readRequiredSentryValue(env, "SENTRY_TRACES_SAMPLE_RATE")),
  };
}

function hasSentryIntegrationNamed(
  integrations: ReadonlyArray<BackendSentryIntegration>,
  integrationName: string,
): boolean {
  return integrations.some((integration) => integration.name === integrationName);
}

function appendSentryIntegrationIfMissing(
  integrations: ReadonlyArray<BackendSentryIntegration>,
  integrationName: string,
  integration: BackendSentryIntegration,
): ReadonlyArray<BackendSentryIntegration> {
  if (hasSentryIntegrationNamed(integrations, integrationName)) {
    return integrations;
  }

  return [...integrations, integration];
}

function createConfiguredOpenAIIntegration(): BackendSentryIntegration {
  return Sentry.openAIIntegration({
    recordInputs: false,
    recordOutputs: false,
  });
}

function createConfiguredSentryIntegrations(
  defaultIntegrations: ReadonlyArray<BackendSentryIntegration>,
): Array<BackendSentryIntegration> {
  const filteredIntegrations = defaultIntegrations.filter(
    (integration) => disabledDefaultIntegrationNames.has(integration.name) === false,
  );
  const integrationsWithHono = [
    ...filteredIntegrations,
    // Error capture is owned by our onError handlers (captureBackendException), which apply the reported/excluded-code policy.
    Sentry.honoIntegration({ shouldHandleError: () => false }),
  ];
  const integrationsWithHttp = appendSentryIntegrationIfMissing(
    integrationsWithHono,
    "Http",
    Sentry.httpIntegration(),
  );
  const integrationsWithFetch = appendSentryIntegrationIfMissing(
    integrationsWithHttp,
    "NodeFetch",
    Sentry.nativeNodeFetchIntegration(),
  );

  return [
    ...integrationsWithFetch,
    createConfiguredOpenAIIntegration(),
  ];
}

function createSentryIntegrations(): BackendSentryIntegrationFactory {
  return (defaultIntegrations) => createConfiguredSentryIntegrations(defaultIntegrations);
}

function readBackendConsoleLogRecord(
  breadcrumb: BackendSentryBreadcrumb,
  hint: BackendSentryBreadcrumbHint,
): Readonly<Record<string, unknown>> | null {
  const breadcrumbData: unknown = breadcrumb.data;
  const consoleArguments: unknown = hint?.input
    ?? (typeof breadcrumbData === "object" && breadcrumbData !== null
      ? (breadcrumbData as Readonly<Record<string, unknown>>).arguments
      : undefined);
  if (!Array.isArray(consoleArguments)) {
    return null;
  }

  const values = consoleArguments as ReadonlyArray<unknown>;
  if (values.length !== 1) {
    return null;
  }

  const record = values[0];
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return null;
  }

  const fields = record as Readonly<Record<string, unknown>>;
  return fields.domain === backendLogRecordDomain ? fields : null;
}

// Lambda console breadcrumbs otherwise render structured log records as [object Object].
function restoreBackendConsoleBreadcrumbMessage(
  breadcrumb: BackendSentryBreadcrumb,
  hint: BackendSentryBreadcrumbHint,
): BackendSentryBreadcrumb {
  if (breadcrumb.category !== consoleBreadcrumbCategory) {
    return breadcrumb;
  }

  try {
    const record = readBackendConsoleLogRecord(breadcrumb, hint);
    if (record === null) {
      return breadcrumb;
    }

    return { ...breadcrumb, message: JSON.stringify(record) };
  } catch {
    return breadcrumb;
  }
}

function capSentryBreadcrumbString(value: string): string {
  return value.length <= maximumSentryBreadcrumbStringChars
    ? value
    : `${cutHeadAtCodePoint(value, maximumSentryBreadcrumbStringChars)}${sentryBreadcrumbTruncationMarker}`;
}

function isPlainSentryBreadcrumbObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Walks only as deep as the SDK's default `normalizeDepth` (3) keeps objects, which also bounds a
// circular value. Only strings, arrays and plain objects are rebuilt; anything else (an Error handed
// to console) is left for the SDK's own normalization. Keep it equal to `normalizeDepth`.
const sentryBreadcrumbNormalizeDepth = 3;

function capSentryBreadcrumbValue(value: unknown, remainingDepth: number): unknown {
  if (typeof value === "string") {
    return capSentryBreadcrumbString(value);
  }

  if (remainingDepth === 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return (value as ReadonlyArray<unknown>).map((item) => capSentryBreadcrumbValue(item, remainingDepth - 1));
  }

  if (isPlainSentryBreadcrumbObject(value)) {
    return capSentryBreadcrumbData(value, remainingDepth);
  }

  return value;
}

function capSentryBreadcrumbData(
  data: Readonly<Record<string, unknown>>,
  remainingDepth: number,
): BackendSentryBreadcrumbData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, capSentryBreadcrumbValue(value, remainingDepth - 1)]),
  );
}

function capSentryBreadcrumbStrings(breadcrumb: BackendSentryBreadcrumb): BackendSentryBreadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: capSentryBreadcrumbString(breadcrumb.message) }),
    ...(breadcrumb.data === undefined ? {} : { data: capSentryBreadcrumbData(breadcrumb.data, sentryBreadcrumbNormalizeDepth) }),
  };
}

export function initializeBackendSentryWithDeps(
  service: BackendService,
  env: NodeJS.ProcessEnv,
  dependencies: InitializeBackendSentryDependencies,
): void {
  currentBackendService = service;
  if (initializedServices.has(service)) {
    return;
  }

  const config = getBackendSentryConfig(env);
  if (!config.enabled) {
    initializedServices.add(service);
    return;
  }

  dependencies.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    traceLifecycle: "stream",
    attachStacktrace: false,
    beforeBreadcrumb: (breadcrumb, hint) => capSentryBreadcrumbStrings(
      restoreBackendConsoleBreadcrumbMessage(breadcrumb, hint),
    ),
    beforeSend: (event, hint) => {
      const sanitizedEvent = sanitizeSentryEvent(event, hint);
      if (sanitizedEvent === null
        || (service !== "store-sandbox-import" && service !== "google-billing-discovery")) {
        return sanitizedEvent;
      }

      // Use the initialized job, including for SDK captures and nested service scopes.
      return {
        ...sanitizedEvent,
        fingerprint: [...(sanitizedEvent.fingerprint ?? ["{{ default }}"]), service],
      };
    },
    beforeSendSpan: (span) => sanitizeSentrySpan({
      ...span,
      attributes: { "backend.service": service, ...span.attributes },
    }),
    integrations: createSentryIntegrations(),
  });
  initializedServices.add(service);
}

export function initializeBackendSentry(service: BackendService): void {
  initializeBackendSentryWithDeps(service, process.env, {
    init: Sentry.init,
  });
}

export function resetBackendSentryForTests(): void {
  initializedServices.clear();
  currentBackendService = null;
}

export function getCurrentBackendService(): BackendService | null {
  return currentBackendService;
}
