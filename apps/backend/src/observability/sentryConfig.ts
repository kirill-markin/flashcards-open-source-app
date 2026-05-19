import * as Sentry from "@sentry/aws-serverless";
import type { BackendService } from "./sentryEvents";
import {
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransactionEvent,
} from "./sentryRedaction";

type InitializeBackendSentryDependencies = Readonly<{
  init: (options: BackendSentryInitOptions) => void;
}>;

type BackendSentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BackendSentryIntegration = ReturnType<typeof Sentry.honoIntegration>;
type BackendSentryIntegrationFactory = (
  defaultIntegrations: Array<BackendSentryIntegration>,
) => Array<BackendSentryIntegration>;

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
