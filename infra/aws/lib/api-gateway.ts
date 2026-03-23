import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import * as path from "path";

export interface ApiGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  apiCertificateArn: string | undefined;
  openAiApiKeySecretArn: string | undefined;
  anthropicApiKeySecretArn: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
}

export interface ApiGatewayResult {
  restApi: apigw.RestApi;
  backendFn: lambdaNodejs.NodejsFunction;
}

interface BackendFunctionProps {
  constructId: string;
  entry: string;
  baseDomain: string;
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  backendCsrfSecret: cdk.aws_secretsmanager.Secret;
  allowedOrigins: string[];
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
  openAiApiKeySecretArn: string | undefined;
  anthropicApiKeySecretArn: string | undefined;
  demoEmailDostip: string | undefined;
  guestAiWeightedMonthlyTokenCap: string | undefined;
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
      `cp ${path.resolve(__dirname, "../../../api/dist/openapi.json")} ${outputDir}/api/dist/openapi.json`,
    ],
  },
};

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

/**
 * Creates a backend Lambda with the shared network, database, auth, and model
 * secret configuration used by both the buffered API handler and the
 * chat-specific streaming handler.
 */
function createBackendFunction(scope: Construct, props: BackendFunctionProps): lambdaNodejs.NodejsFunction {
  const fn = new lambdaNodejs.NodejsFunction(scope, props.constructId, {
    entry: props.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.minutes(15),
    memorySize: 256,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.backendDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      BACKEND_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
      BACKEND_CSRF_SECRET_ARN: props.backendCsrfSecret.secretArn,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP: props.guestAiWeightedMonthlyTokenCap ?? "0",
    },
  });

  props.backendDbSecret.grantRead(fn);
  props.backendCsrfSecret.grantRead(fn);
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
  addLambdaSecretEnvironment(
    scope,
    fn,
    props.anthropicApiKeySecretArn,
    `${props.constructId}AnthropicApiKeySecret`,
    "ANTHROPIC_API_KEY",
  );
  if (props.demoEmailDostip !== undefined && props.demoEmailDostip !== "") {
    fn.addEnvironment("DEMO_EMAIL_DOSTIP", props.demoEmailDostip);
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
    "http://localhost:3000",
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

  const backendFn = createBackendFunction(scope, {
    constructId: "BackendHandler",
    entry: path.join(__dirname, "../../../apps/backend/src/lambda.ts"),
    baseDomain: props.baseDomain,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    backendCsrfSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    anthropicApiKeySecretArn: props.anthropicApiKeySecretArn,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
  });
  const chatStreamingFn = createBackendFunction(scope, {
    constructId: "ChatStreamingHandler",
    entry: path.join(__dirname, "../../../apps/backend/src/lambda-stream.ts"),
    baseDomain: props.baseDomain,
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    backendDbSecret: props.backendDbSecret,
    backendCsrfSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolArn: props.userPoolArn,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    anthropicApiKeySecretArn: props.anthropicApiKeySecretArn,
    demoEmailDostip: props.demoEmailDostip,
    guestAiWeightedMonthlyTokenCap: props.guestAiWeightedMonthlyTokenCap,
  });

  const restApi = new apigw.RestApi(scope, "Api", {
    restApiName: "flashcards-open-source-app-api",
    description: "Public API for flashcards mobile clients",
    binaryMediaTypes: ["multipart/form-data"],
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    },
    defaultCorsPreflightOptions: {
      allowOrigins: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-csrf-token"],
      allowCredentials: true,
    },
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

  /**
   * Routes the SSE chat endpoints through a dedicated streaming Lambda instead
   * of waiting for the full response body.
   *
   * The Hono `streamHandle(app)` adapter and API Gateway response transfer mode
   * must be used together for SSE. Applying that adapter to the main backend
   * Lambda breaks buffered proxy routes such as `/health`, so the streaming
   * chat paths keep their own entry point while the rest of the API stays on
   * the classic buffered Lambda integration.
   *
   * Only `/chat/turn` uses this integration. The diagnostics endpoint
   * stays on the buffered path because it returns a normal `204` response and
   * does not need streaming semantics.
   */
  const streamingIntegration = new apigw.LambdaIntegration(chatStreamingFn, {
    timeout: cdk.Duration.minutes(15),
    responseTransferMode: apigw.ResponseTransferMode.STREAM,
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

  const me = restApi.root.addResource("me");
  me.addMethod("GET", integration);
  me.addResource("delete").addMethod("POST", integration);

  const chat = restApi.root.addResource("chat");
  const turn = chat.addResource("turn");
  turn.addMethod("POST", streamingIntegration);
  chat.addResource("transcriptions").addMethod("POST", integration);
  turn.addResource("diagnostics").addMethod("POST", integration);

  const guestAuth = restApi.root.addResource("guest-auth");
  guestAuth.addResource("session").addMethod("POST", integration);
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

  return { restApi, backendFn };
}
