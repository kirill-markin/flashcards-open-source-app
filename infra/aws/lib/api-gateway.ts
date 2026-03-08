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
  appDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  apiCertificateArn: string | undefined;
  openAiApiKeySecretArn: string | undefined;
  anthropicApiKeySecretArn: string | undefined;
  userPoolId: string;
  userPoolClientId: string;
}

export interface ApiGatewayResult {
  restApi: apigw.RestApi;
  backendFn: lambdaNodejs.NodejsFunction;
}

interface BackendFunctionProps {
  constructId: string;
  entry: string;
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  appDbSecret: cdk.aws_secretsmanager.Secret;
  backendCsrfSecret: cdk.aws_secretsmanager.Secret;
  allowedOrigins: string[];
  userPoolId: string;
  userPoolClientId: string;
  openAiApiKeySecretArn: string | undefined;
  anthropicApiKeySecretArn: string | undefined;
}

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      `curl -sfo ${outputDir}/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
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
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.appDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      AUTH_MODE: "cognito",
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      BACKEND_ALLOWED_ORIGINS: props.allowedOrigins.join(","),
      BACKEND_CSRF_SECRET_ARN: props.backendCsrfSecret.secretArn,
    },
  });

  props.appDbSecret.grantRead(fn);
  props.backendCsrfSecret.grantRead(fn);
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
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    appDbSecret: props.appDbSecret,
    backendCsrfSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    anthropicApiKeySecretArn: props.anthropicApiKeySecretArn,
  });
  const chatStreamingFn = createBackendFunction(scope, {
    constructId: "ChatStreamingHandler",
    entry: path.join(__dirname, "../../../apps/backend/src/lambda-stream.ts"),
    vpc: props.vpc,
    lambdaSg: props.lambdaSg,
    db: props.db,
    appDbSecret: props.appDbSecret,
    backendCsrfSecret,
    allowedOrigins,
    userPoolId: props.userPoolId,
    userPoolClientId: props.userPoolClientId,
    openAiApiKeySecretArn: props.openAiApiKeySecretArn,
    anthropicApiKeySecretArn: props.anthropicApiKeySecretArn,
  });

  const restApi = new apigw.RestApi(scope, "Api", {
    restApiName: "flashcards-open-source-app-api",
    description: "Public API for flashcards mobile clients",
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    },
    defaultCorsPreflightOptions: {
      allowOrigins: allowedOrigins,
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-csrf-token"],
      allowCredentials: true,
    },
  });

  /**
   * Keeps the existing buffered Lambda proxy behavior for JSON-style endpoints.
   * Those routes only return complete payloads, so streaming would add no value
   * and would widen the blast radius of the chat-specific transport change.
   */
  const integration = new apigw.LambdaIntegration(backendFn);

  /**
   * Routes `/chat` through a dedicated streaming Lambda instead of waiting for
   * the full response body.
   *
   * The Hono `streamHandle(app)` adapter and API Gateway response transfer mode
   * must be used together for SSE. Applying that adapter to the main backend
   * Lambda breaks buffered proxy routes such as `/health`, so chat keeps its
   * own entry point while the rest of the API stays on the classic buffered
   * Lambda integration.
   *
   * Only `/chat` uses this integration. The diagnostics endpoint stays on the
   * buffered path because it returns a normal `204` response and does not need
   * streaming semantics.
   */
  const streamingIntegration = new apigw.LambdaIntegration(chatStreamingFn, {
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

  const health = restApi.root.addResource("health");
  health.addMethod("GET", integration);

  const me = restApi.root.addResource("me");
  me.addMethod("GET", integration);

  const cards = restApi.root.addResource("cards");
  cards.addMethod("GET", integration);
  cards.addMethod("POST", integration);
  const cardById = cards.addResource("{cardId}");
  cardById.addMethod("GET", integration);
  cardById.addMethod("PATCH", integration);

  const decks = restApi.root.addResource("decks");
  decks.addMethod("GET", integration);
  decks.addMethod("POST", integration);

  const reviewQueue = restApi.root.addResource("review-queue");
  reviewQueue.addMethod("GET", integration);

  const reviews = restApi.root.addResource("reviews");
  reviews.addMethod("POST", integration);

  const chat = restApi.root.addResource("chat");
  chat.addMethod("POST", streamingIntegration);
  chat.addResource("diagnostics").addMethod("POST", integration);

  const sync = restApi.root.addResource("sync");
  sync.addResource("push").addMethod("POST", integration);
  sync.addResource("pull").addMethod("POST", integration);

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
