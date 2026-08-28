import * as Sentry from "@sentry/aws-serverless";
import type { BackendService } from "./events";
import {
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransactionEvent,
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
const disabledDefaultIntegrationNames = new Set<string>(["Postgres", "OpenAI"]);
const consoleBreadcrumbCategory = "console";
const backendLogRecordDomain = "backend";

let currentBackendService: BackendService | null = null;
let backendSentryInitializedForOpenTelemetry = false;

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
  const integrationsWithHono = appendSentryIntegrationIfMissing(
    filteredIntegrations,
    "Hono",
    Sentry.honoIntegration(),
  );
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

// Recognizes one of this backend's own structured log records among the arguments of a console
// breadcrumb. `domain: "backend"` is on every record this repository hands to `console` as an object
// - the ones from ../cloudWatch.ts and ../../server/logging.ts, and the ones the direct image
// ingestion and multipart reconciliation entrypoints build inline - and on nothing else, so this
// matches exactly those calls and leaves every dependency's console output alone.
//
// The console arguments are read from the hint, which is where Sentry documents them for this
// category, and from the breadcrumb's own `data.arguments` when the hint carries none: the
// integration sets both in the same call, so either one is enough and neither is assumed.
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

/**
 * Restores the readable `message` on the console breadcrumbs Sentry raises for this backend's own
 * structured records.
 *
 * Those records are handed to `console` as objects rather than pre-serialized JSON
 * (../cloudWatch.ts), which is the only thing that makes `$.message.<field>` resolvable for the
 * log-derived metric filters in `infra/aws/lib/monitoring.ts` and
 * `infra/aws/lib/product-analytics-monitoring.ts`. The default `consoleIntegration` turns every such
 * call into a `category: "console"` breadcrumb, and inside a Lambda it builds that
 * breadcrumb's `message` with `safeJoin`, not `util.format`: the pinned @sentry/core reaches
 * `util.format` only when `globalThis.util` exists, which is true under `node -e`, `node -p` and the
 * REPL and false in a loaded handler file. `safeJoin` renders any object as the constant
 * `[object Object]`, so without this hook every one of those breadcrumbs would carry no field of the
 * record, where the pre-serialized string used to carry all of them.
 *
 * The paired explicit breadcrumbs do not cover that on their own: `addBackendBreadcrumb` and
 * `logAdminQueryEvent` do add an `addBackendSentryBreadcrumb` beside each console write, but a
 * warning or an exception carries its structured copy as a `backend.details` context on its own
 * event rather than as a breadcrumb - so it is missing from the *trail* of any later event - and
 * `logRequestError`'s error-level branch and `reportDirectImageIngestionHandled5xx` pair with
 * nothing at all.
 *
 * What this does not do is as important as what it does. It does not change the object handed to
 * `console`, which the metric filters depend on. It does not disable `consoleIntegration`, which is
 * also what captures console output from dependencies that no explicit breadcrumb replaces. And it
 * is scoped to records this backend emits rather than to console objects in general, so a
 * dependency's breadcrumbs keep the message and the size they have today.
 *
 * Global side effect, stated because `beforeBreadcrumb` is a client-wide hook: it runs for every
 * breadcrumb the process produces, including ones from dependencies, and rewrites the message of
 * those that match the check above. What it puts there is what the pre-serialized string used to put
 * there - the same record, `JSON.stringify`d, already sanitized before it ever reached `console` -
 * so this restores a payload rather than introducing one. It is more than the same breadcrumb's
 * `data.arguments` carries, because the client's `normalizeDepth` of 3 drops the record's nested
 * `details` there.
 */
function restoreBackendConsoleBreadcrumbMessage(
  breadcrumb: BackendSentryBreadcrumb,
  hint: BackendSentryBreadcrumbHint,
): BackendSentryBreadcrumb {
  if (breadcrumb.category !== consoleBreadcrumbCategory) {
    return breadcrumb;
  }

  const record = readBackendConsoleLogRecord(breadcrumb, hint);
  if (record === null) {
    return breadcrumb;
  }

  try {
    return { ...breadcrumb, message: JSON.stringify(record) };
  } catch {
    return breadcrumb;
  }
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
    sendDefaultPii: false,
    beforeBreadcrumb: (breadcrumb, hint) => restoreBackendConsoleBreadcrumbMessage(breadcrumb, hint),
    beforeSend: (event, hint) => sanitizeSentryEvent(event, hint),
    beforeSendSpan: (span) => sanitizeSentrySpan(span),
    beforeSendTransaction: (event) => sanitizeSentryTransactionEvent(event),
    integrations: createSentryIntegrations(),
  });
  backendSentryInitializedForOpenTelemetry = true;
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
  backendSentryInitializedForOpenTelemetry = false;
}

export function isBackendSentryInitializedForOpenTelemetry(): boolean {
  return backendSentryInitializedForOpenTelemetry;
}

export function getCurrentBackendService(): BackendService | null {
  return currentBackendService;
}
