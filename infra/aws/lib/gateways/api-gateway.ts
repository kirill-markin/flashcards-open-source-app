import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { backendNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { createSafeApiGatewayAccessLogFormat } from "./api-gateway-access-log";
import { createSentrySourceMapUploadCommand } from "../sentry-source-maps";

export interface ApiGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  baseDomain: string;
  apiCertificateArn: string | undefined;
  openAiApiKeySecretArn: string | undefined;
  langfusePublicKeySecretArn: string | undefined;
  langfuseSecretKeySecretArn: string | undefined;
  langfuseBaseUrl: string | undefined;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  globalMetricsVisible: boolean;
  globalMetricsSnapshotBucket: s3.IBucket;
  globalMetricsSnapshotObjectKey: string;
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
}

export interface ApiGatewayResult {
  restApi: apigw.RestApi;
  backendFn: lambdaNodejs.NodejsFunction;
  chatWorkerFn: lambdaNodejs.NodejsFunction;
  chatLiveFn: lambdaNodejs.NodejsFunction;
  chatLiveFunctionUrl: lambda.FunctionUrl;
}

interface BackendFunctionProps {
  constructId: string;
  entry: string;
  baseDomain: string;
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  backendCsrfSecret: cdk.aws_secretsmanager.Secret;
  backendChatLiveAuthSecret: cdk.aws_secretsmanager.Secret;
  allowedOrigins: string[];
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
  openAiApiKeySecretArn: string | undefined;
  langfusePublicKeySecretArn: string | undefined;
  langfuseSecretKeySecretArn: string | undefined;
  langfuseBaseUrl: string | undefined;
  sentryConfig: BackendSentryConfig;
  resendApiKeySecretArn: string | undefined;
  resendSenderEmail: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  globalMetricsConfig: GlobalMetricsConfig | undefined;
  memorySize: number;
}

interface GlobalMetricsConfig {
  visible: boolean;
  snapshotBucket: s3.IBucket;
  snapshotObjectKey: string;
}

export interface BackendSentryConfig {
  dsnSecretArn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
  tracesSampleRate: string | undefined;
}

interface ResolvedBackendSentryConfig {
  dsnSecretArn: string;
  environment: string;
  release: string;
  tracesSampleRate: string;
}

export interface GatewayErrorResponseHeaders {
  readonly [headerName: string]: string;
  readonly "Access-Control-Allow-Origin": string;
  readonly Vary: string;
  readonly "Access-Control-Allow-Headers": string;
  readonly "Access-Control-Allow-Methods": string;
  readonly "Access-Control-Allow-Credentials": string;
  readonly "Access-Control-Expose-Headers": string;
  readonly "X-Request-Id": string;
}

const browserCorsAllowHeaders = [
  "content-type",
  "authorization",
  "x-csrf-token",
  "sentry-trace",
  "baggage",
  "x-chat-request-id",
  "x-chat-resume-attempt-id",
  "x-client-platform",
  "x-client-version",
] as const;

const browserCorsExposeHeaders = [
  "x-request-id",
] as const;

const gatewayErrorCorsExposeHeaders = [
  ...browserCorsExposeHeaders,
  "x-amzn-requestid",
  "x-amz-apigw-id",
] as const;

export const globalMetricsCorsPreflightOptions: apigw.CorsOptions = {
  allowOrigins: ["*"],
  allowMethods: ["GET", "OPTIONS"],
  allowHeaders: ["content-type", "authorization", "sentry-trace", "baggage"],
};

function createBrowserCorsPreflightOptions(allowedOrigins: string[]): apigw.CorsOptions {
  return {
    allowOrigins: allowedOrigins,
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: [...browserCorsAllowHeaders],
    allowCredentials: true,
  };
}

export function createChatLiveFunctionUrlCorsOptions(
  allowedOrigins: readonly string[],
): lambda.FunctionUrlCorsOptions {
  return {
    allowedOrigins: [...allowedOrigins],
    allowedMethods: [lambda.HttpMethod.GET],
    allowedHeaders: [...browserCorsAllowHeaders],
    exposedHeaders: [...browserCorsExposeHeaders],
    allowCredentials: true,
  };
}

export function createGatewayErrorResponseHeaders(): GatewayErrorResponseHeaders {
  return {
    "Access-Control-Allow-Origin": "method.request.header.Origin",
    "Vary": "'Origin'",
    "Access-Control-Allow-Headers": `'${browserCorsAllowHeaders.join(",")}'`,
    "Access-Control-Allow-Methods": "'GET,POST,PATCH,OPTIONS'",
    "Access-Control-Allow-Credentials": "'true'",
    "Access-Control-Expose-Headers": `'${gatewayErrorCorsExposeHeaders.join(",")}'`,
    "X-Request-Id": "context.requestId",
  };
}

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
      `mkdir -p ${outputDir}/api/dist`,
      `cp ${resolveFromRepoRoot("api", "dist", "openapi.json")} ${outputDir}/api/dist/openapi.json`,
      createSentrySourceMapUploadCommand(outputDir),
    ],
  },
};

function getLangfuseSecretConfig(
  props: Readonly<{
    langfusePublicKeySecretArn: string | undefined;
    langfuseSecretKeySecretArn: string | undefined;
    langfuseBaseUrl: string | undefined;
  }>,
): Readonly<{
  publicKeySecretArn: string;
  secretKeySecretArn: string;
  baseUrl: string;
}> | null {
  const hasPublicKeySecret = props.langfusePublicKeySecretArn !== undefined && props.langfusePublicKeySecretArn !== "";
  const hasSecretKeySecret = props.langfuseSecretKeySecretArn !== undefined && props.langfuseSecretKeySecretArn !== "";

  if (!hasPublicKeySecret && !hasSecretKeySecret) {
    return null;
  }

  if (!hasPublicKeySecret || !hasSecretKeySecret) {
    throw new Error("langfusePublicKeySecretArn and langfuseSecretKeySecretArn must both be set when Langfuse is configured");
  }

  return {
    publicKeySecretArn: props.langfusePublicKeySecretArn as string,
    secretKeySecretArn: props.langfuseSecretKeySecretArn as string,
    baseUrl: props.langfuseBaseUrl ?? "https://cloud.langfuse.com",
  };
}

function addLambdaSecretEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  secretArn: string | undefined,
  constructId: string,
  environmentVariableName: string,
): void {
  if (secretArn === undefined || secretArn === "") {
    return;
  }

  const secret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(scope, constructId, secretArn);
  secret.grantRead(fn);
  fn.addEnvironment(environmentVariableName, secret.secretValue.unsafeUnwrap());
}

function addGlobalMetricsEnvironment(
  fn: lambdaNodejs.NodejsFunction,
  config: GlobalMetricsConfig,
): void {
  fn.addEnvironment("GLOBAL_METRICS_VISIBLE", config.visible ? "true" : "false");
  fn.addEnvironment("GLOBAL_METRICS_S3_BUCKET_NAME", config.snapshotBucket.bucketName);
  fn.addEnvironment("GLOBAL_METRICS_S3_OBJECT_KEY", config.snapshotObjectKey);
  fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [config.snapshotBucket.arnForObjects(config.snapshotObjectKey)],
  }));
}

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function getResolvedBackendSentryConfig(config: BackendSentryConfig): ResolvedBackendSentryConfig | null {
  if (!hasConfiguredValue(config.dsnSecretArn)) {
    return null;
  }

  if (!hasConfiguredValue(config.environment)) {
    throw new Error("sentryEnvironment is required when sentryDsnSecretArn is configured");
  }
  if (!hasConfiguredValue(config.release)) {
    throw new Error("sentryRelease is required when sentryDsnSecretArn is configured");
  }
  if (!hasConfiguredValue(config.tracesSampleRate)) {
    throw new Error("sentryTracesSampleRate is required when sentryDsnSecretArn is configured");
  }

  const tracesSampleRate = Number(config.tracesSampleRate);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }

  return {
    dsnSecretArn: config.dsnSecretArn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
  };
}

function addBackendSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  config: BackendSentryConfig,
  constructId: string,
): void {
  const resolvedConfig = getResolvedBackendSentryConfig(config);
  if (resolvedConfig === null) {
    return;
  }

  addLambdaSecretEnvironment(scope, fn, resolvedConfig.dsnSecretArn, `${constructId}SentryDsnSecret`, "SENTRY_DSN");
  fn.addEnvironment("SENTRY_ENVIRONMENT", resolvedConfig.environment);
  fn.addEnvironment("SENTRY_RELEASE", resolvedConfig.release);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", resolvedConfig.tracesSampleRate);
}

/**
 * Creates a backend Lambda with the shared network, database, auth, and model
 * secret configuration used by the public backend handler and detached worker.
 */
function createBackendFunction(scope: Construct, props: BackendFunctionProps): lambdaNodejs.NodejsFunction {
  const langfuseConfig = getLangfuseSecretConfig(props);
  const fn = new lambdaNodejs.NodejsFunction(scope, props.constructId, {
    entry: props.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(15),
    memorySize: props.memorySize,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...backendNodejsProjectPaths,
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      REPORTING_DB_SECRET_ARN: props.reportingDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      BACKEND_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
      BACKEND_CSRF_SECRET_ARN: props.backendCsrfSecret.secretArn,
      BACKEND_CHAT_LIVE_AUTH_SECRET_ARN: props.backendChatLiveAuthSecret.secretArn,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP: props.guestAiWeightedMonthlyTokenCap ?? "0",
      ...(langfuseConfig === null
        ? {}
        : { LANGFUSE_BASE_URL: langfuseConfig.baseUrl }),
    },
  });

  props.backendDbSecret.grantRead(fn);
  props.reportingDbSecret.grantRead(fn);
  props.backendCsrfSecret.grantRead(fn);
  props.backendChatLiveAuthSecret.grantRead(fn);
  fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
    actions: ["cognito-idp:AdminDeleteUser"],
    resources: [props.userPoolArn],
  }));
  addLambdaSecretEnvironment(
    scope,
    fn,
    props.openAiApiKeySecretArn,
    `${props.constructId}OpenAiApiKeySecret`,
    "OPENAI_API_KEY",
  );
  if (langfuseConfig !== null) {
    addLambdaSecretEnvironment(
      scope,
      fn,
      langfuseConfig.publicKeySecretArn,
      `${props.constructId}LangfusePublicKeySecret`,
      "LANGFUSE_PUBLIC_KEY",
    );
    addLambdaSecretEnvironment(
      scope,
      fn,
      langfuseConfig.secretKeySecretArn,
      `${props.constructId}LangfuseSecretKeySecret`,
      "LANGFUSE_SECRET_KEY",
    );
  }
  addBackendSentryEnvironment(scope, fn, props.sentryConfig, props.constructId);
  addLambdaSecretEnvironment(
    scope,
    fn,
    props.resendApiKeySecretArn,
    `${props.constructId}ResendApiKeySecret`,
    "RESEND_API_KEY",
  );
  if (hasConfiguredValue(props.resendSenderEmail)) {
    fn.addEnvironment("RESEND_FROM_EMAIL", props.resendSenderEmail);
  }
  if (props.demoEmailDostip !== undefined && props.demoEmailDostip !== "") {
    fn.addEnvironment("DEMO_EMAIL_DOSTIP", props.demoEmailDostip);
  }

  if (props.globalMetricsConfig !== undefined) {
    addGlobalMetricsEnvironment(fn, props.globalMetricsConfig);
  }

  return fn;
}

/**
 * Builds the public REST API resources that API Gateway must know about ahead
 * of time, including chat subpaths that are handled dynamically inside Hono.
 */
export function apiGateway(scope: Construct, props: ApiGatewayProps): ApiGatewayResult {
  const allowedOrigins = [
    `https://app.${props.baseDomain}`,
    `https://admin.${props.baseDomain}`,
    "http://localhost:3000",
    "http://localhost:3001",
  ];
  const backendCsrfSecret = new cdk.aws_secretsmanager.Secret(scope, "BackendCsrfSecret", {
    secretName: "flashcards-open-source-app/backend-csrf-secret",
    generateSecretString: {
      passwordLength: 64,
      includeSpace: false,
      excludeUppercase: true,
      excludePunctuation: true,
      excludeCharacters: "ghijklmnopqrstuvwxyz",
      requireEachIncludedType: false,
    },
  });
  const backendChatLiveAuthSecret = new cdk.aws_secretsmanager.Secret(scope, "BackendChatLiveAuthSecret", {
    secretName: "flashcards-open-source-app/backend-chat-live-auth-secret",
    generateSecretString: {
      passwordLength: 64,
      includeSpace: false,
      excludeUppercase: true,
      excludePunctuation: true,
      excludeCharacters: "ghijklmnopqrstuvwxyz",
      requireEachIncludedType: false,
    },
  });

  const backendFn = createBackendFunction(scope, {
    constructId: "BackendHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda.ts"),
    baseDomain: props.baseDomain,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: props.resendApiKeySecretArn,
    resendSenderEmail: props.resendSenderEmail,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: {
      visible: props.globalMetricsVisible,
      snapshotBucket: props.globalMetricsSnapshotBucket,
      snapshotObjectKey: props.globalMetricsSnapshotObjectKey,
    },
    memorySize: 256,
  });
  const chatWorkerFn = createBackendFunction(scope, {
    constructId: "ChatRunWorkerHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-chat-worker.ts"),
    baseDomain: props.baseDomain,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: undefined,
    resendSenderEmail: undefined,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: undefined,
    memorySize: 512,
  });
  const chatLiveFn = createBackendFunction(scope, {
    constructId: "ChatLiveHandler",
    entry: resolveFromRepoRoot("apps", "backend", "src", "entrypoints", "lambda-chat-live.ts"),
    baseDomain: props.baseDomain,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    reportingDbSecret: props.reportingDbSecret,
    backendCsrfSecret,
    backendChatLiveAuthSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    langfusePublicKeySecretArn: props.langfusePublicKeySecretArn,
    langfuseSecretKeySecretArn: props.langfuseSecretKeySecretArn,
    langfuseBaseUrl: props.langfuseBaseUrl,
    sentryConfig: {
      dsnSecretArn: props.sentryDsnSecretArn,
      environment: props.sentryEnvironment,
      release: props.sentryRelease,
      tracesSampleRate: props.sentryTracesSampleRate,
    },
    resendApiKeySecretArn: undefined,
    resendSenderEmail: undefined,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
    globalMetricsConfig: undefined,
    memorySize: 256,
  });
  const chatLiveFunctionUrl = chatLiveFn.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.NONE,
    invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    cors: createChatLiveFunctionUrlCorsOptions(allowedOrigins),
  });

  backendFn.addEnvironment("CHAT_WORKER_FUNCTION_NAME", chatWorkerFn.functionName);
  backendFn.addEnvironment("CHAT_LIVE_URL", chatLiveFunctionUrl.url);
  chatWorkerFn.grantInvoke(backendFn);
  const accessLogGroup = new logs.LogGroup(scope, "ApiAccessLogGroup", {
    retention: logs.RetentionDays.ONE_WEEK,
  });

  const restApi = new apigw.RestApi(scope, "Api", {
    restApiName: "flashcards-open-source-app-api",
    description: "Public API for flashcards mobile clients",
    binaryMediaTypes: ["multipart/form-data"],
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
      metricsEnabled: true,
      dataTraceEnabled: false,
      tracingEnabled: false,
      accessLogDestination: new apigw.LogGroupLogDestination(accessLogGroup),
      accessLogFormat: createSafeApiGatewayAccessLogFormat(),
    },
    defaultCorsPreflightOptions: createBrowserCorsPreflightOptions(allowedOrigins),
  });
  const gatewayErrorResponseHeaders = createGatewayErrorResponseHeaders();

  new apigw.GatewayResponse(scope, "ApiDefault4xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_4XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  new apigw.GatewayResponse(scope, "ApiDefault5xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_5XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  /**
   * Keeps the existing buffered Lambda proxy behavior for JSON-style endpoints.
   * Those routes only return complete payloads, so streaming would add no value
   * and would widen the blast radius of the chat-specific transport change.
   *
   * Permission scoping is intentionally API-wide instead of method-wide. The
   * backend now has enough public resources that per-method Lambda permissions
   * exceed the Lambda resource-policy size limit during deployment.
   */
  const integration = new apigw.LambdaIntegration(backendFn, {
    scopePermissionToMethod: false,
  });

  const notFoundIntegration = new apigw.MockIntegration({
    requestTemplates: {
      "application/json": '{"statusCode": 404}',
    },
    integrationResponses: [
      {
        statusCode: "404",
        responseTemplates: {
          "application/json": '{"error":"Not found"}',
        },
      },
    ],
  });
  const notFoundMethodOptions: apigw.MethodOptions = {
    methodResponses: [
      {
        statusCode: "404",
      },
    ],
  };

  restApi.root.addMethod("GET", integration);

  const agent = restApi.root.addResource("agent");
  agent.addMethod("GET", integration);
  agent.addResource("openapi.json").addMethod("GET", integration);
  agent.addResource("swagger.json").addMethod("GET", integration);
  agent.addResource("me").addMethod("GET", integration);

  restApi.root.addResource("openapi.json").addMethod("GET", integration);
  restApi.root.addResource("swagger.json").addMethod("GET", integration);

  const health = restApi.root.addResource("health");
  health.addMethod("GET", integration);

  const global = restApi.root.addResource("global");
  const globalSnapshot = global.addResource("snapshot", {
    defaultCorsPreflightOptions: globalMetricsCorsPreflightOptions,
  });
  globalSnapshot.addMethod("GET", integration);

  const me = restApi.root.addResource("me");
  me.addMethod("GET", integration);
  me.addResource("preferences").addMethod("PATCH", integration);
  const meCommunity = me.addResource("community");
  const meCommunityProfile = meCommunity.addResource("profile");
  meCommunityProfile.addMethod("GET", integration);
  meCommunityProfile.addMethod("PATCH", integration);
  const meCommunityFriendInvitations = meCommunity.addResource("friend-invitations");
  meCommunityFriendInvitations.addMethod("POST", integration);
  meCommunityFriendInvitations
    .addResource("{inviteToken}")
    .addResource("accept")
    .addMethod("POST", integration);
  const meProgress = me.addResource("progress");
  meProgress.addResource("summary").addMethod("GET", integration);
  meProgress.addResource("review-schedule").addMethod("GET", integration);
  meProgress.addResource("series").addMethod("GET", integration);
  meProgress.addResource("leaderboard").addMethod("GET", integration);
  const meProgressLeaderboards = meProgress.addResource("leaderboards");
  const meProgressLeaderboardProfiles = meProgressLeaderboards.addResource("profiles");
  meProgressLeaderboardProfiles.addResource("{publicProfileId}").addMethod("GET", integration);
  meProgressLeaderboards.addResource("streak").addMethod("GET", integration);
  me.addResource("delete").addMethod("POST", integration);

  const community = restApi.root.addResource("community");
  const communityFriendInvitations = community.addResource("friend-invitations");
  communityFriendInvitations.addResource("{inviteToken}").addMethod("GET", integration);

  const feedback = restApi.root.addResource("feedback");
  feedback.addResource("state").addMethod("GET", integration);
  feedback.addResource("prompt-events").addMethod("POST", integration);
  feedback.addResource("submissions").addMethod("POST", integration);

  const admin = restApi.root.addResource("admin");
  admin.addResource("session").addMethod("GET", integration);
  const adminReports = admin.addResource("reports");
  adminReports.addResource("query").addMethod("POST", integration);

  const chat = restApi.root.addResource("chat");
  chat.addMethod("GET", integration);
  chat.addMethod("POST", integration);
  chat.addResource("new").addMethod("POST", integration);
  chat.addResource("stop").addMethod("POST", integration);
  chat.addResource("transcriptions").addMethod("POST", integration);

  const guestAuth = restApi.root.addResource("guest-auth");
  const guestSession = guestAuth.addResource("session");
  guestSession.addMethod("POST", integration);
  guestSession.addResource("delete").addMethod("POST", integration);
  const guestUpgrade = guestAuth.addResource("upgrade");
  guestUpgrade.addResource("prepare").addMethod("POST", integration);
  guestUpgrade.addResource("complete").addMethod("POST", integration);

  const workspaces = restApi.root.addResource("workspaces");
  workspaces.addMethod("GET", integration);
  workspaces.addMethod("POST", integration);
  const agentWorkspaces = agent.addResource("workspaces");
  agentWorkspaces.addMethod("GET", integration);
  agentWorkspaces.addMethod("POST", integration);

  const agentApiKeys = restApi.root.addResource("agent-api-keys");
  agentApiKeys.addMethod("GET", integration);
  agentApiKeys
    .addResource("{connectionId}")
    .addResource("revoke")
    .addMethod("POST", integration);

  // Keep this manual resource list aligned with apps/backend/src/routes/*.ts.
  // API Gateway must know each public path ahead of time, or requests will fail
  // at the edge with MissingAuthenticationTokenException before Lambda runs.
  const workspaceById = workspaces.addResource("{workspaceId}");
  const agentWorkspaceById = agentWorkspaces.addResource("{workspaceId}");
  workspaceById.addResource("select").addMethod("POST", integration);
  workspaceById.addResource("rename").addMethod("POST", integration);
  workspaceById.addResource("delete-preview").addMethod("GET", integration);
  workspaceById.addResource("delete").addMethod("POST", integration);
  workspaceById.addResource("reset-progress-preview").addMethod("GET", integration);
  workspaceById.addResource("reset-progress").addMethod("POST", integration);
  agentWorkspaceById.addResource("select").addMethod("POST", integration);
  workspaceById.addResource("tags").addMethod("GET", integration);
  workspaceById
    .addResource("cards")
    .addResource("query")
    .addMethod("POST", integration);

  const workspaceSync = workspaceById.addResource("sync");
  workspaceSync.addResource("push").addMethod("POST", integration);
  workspaceSync.addResource("pull").addMethod("POST", integration);
  workspaceSync.addResource("bootstrap").addMethod("POST", integration);
  const workspaceSyncReviewHistory = workspaceSync.addResource("review-history");
  workspaceSyncReviewHistory.addResource("pull").addMethod("POST", integration);
  workspaceSyncReviewHistory.addResource("import").addMethod("POST", integration);

  agent.addResource("sql").addMethod("POST", integration);

  const legacyAuth = restApi.root.addResource("auth");
  legacyAuth.addMethod("ANY", notFoundIntegration, notFoundMethodOptions);
  legacyAuth.addResource("{proxy+}").addMethod("ANY", notFoundIntegration, notFoundMethodOptions);

  if (props.apiCertificateArn) {
    const apiDomainName = `api.${props.baseDomain}`;
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "ApiCertificate",
      props.apiCertificateArn,
    );

    const domain = restApi.addDomainName("ApiCustomDomain", {
      domainName: apiDomainName,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
      basePath: "v1",
    });

    new cdk.CfnOutput(scope, "ApiCustomDomainTarget", {
      value: domain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for api.<domain> to this target",
    });
  }

  new cdk.CfnOutput(scope, "ChatLiveFunctionUrl", {
    value: chatLiveFunctionUrl.url,
    description: "Lambda Function URL for the SSE live chat stream",
  });

  return { restApi, backendFn, chatWorkerFn, chatLiveFn, chatLiveFunctionUrl };
}
