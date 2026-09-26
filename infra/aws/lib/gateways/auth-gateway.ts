import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { createSafeApiGatewayAccessLogFormat } from "./api-gateway-access-log";
import {
  authHandlerReservedConcurrency,
  databasePoolMaxConnectionsEnvName,
  databasePoolMaxConnectionsEnvValue,
} from "../lambda-database-capacity";
import { authNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";
import { normalizeHost } from "../alternate-host";
import { parsePublicOrigin } from "../public-origin";
import { buildCookieDomains } from "../cookie-domains";
import { getMcpResourceUrl, getPrimaryMcpHost } from "../mcp-alternate-host";
import { createRdsCaBundleDownloadCommand } from "../rds-ca-bundle";

export interface AuthGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  authDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  // Optional per-deploy override for the API origin this service advertises in
  // its agent envelopes and calls for sign-in analytics. Unset means
  // api.<baseDomain>, exactly as before it was settable.
  apiBaseUrl: string | undefined;
  authCertificateArn: string | undefined;
  // Optional second public auth host, already resolved (../alternate-host.ts) and
  // undefined unless both of its context values are set. auth.<baseDomain> is
  // created either way.
  authAlternateHost: string | undefined;
  authAlternateCertificateArn: string | undefined;
  // Created by the API gateway, not here. This service only needs the name so
  // both services compute one identical COOKIE_DOMAIN from one identical set of
  // browser hosts; see buildCookieDomains.
  apiAlternateHost: string | undefined;
  // Adds a candidate domain to COOKIE_DOMAIN. Unset means baseDomain alone, so
  // moving browsers to another domain is its own switch.
  cookieDomain: string | undefined;
  // Second public MCP host, already resolved (../mcp-alternate-host.ts) and
  // undefined unless both alternate context values are set.
  mcpAlternateHost: string | undefined;
  // Second hosts for the browser bundles, owned by the CloudFront distributions
  // and already resolved (../cloudfront-additional-host.ts). Auth needs their
  // names because ALLOWED_REDIRECT_URIS is the only allowlist a browser origin
  // can reach auth through at all; see buildAllowedRedirectUris.
  webAdditionalHost: string | undefined;
  adminAdditionalHost: string | undefined;
  demoEmailDostip: string | undefined;
  demoPasswordSecretArn: string | undefined;
  userPoolId: string;
  userPoolClientId: string;
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

/**
 * Browser origins the auth service accepts. One value carries two allowlists:
 * the login and logout `redirect_uri` targets
 * (`apps/auth/src/routes/browser/loginPage.ts`) and the auth API's CORS
 * allowlist (`getAllowedApiOrigins` in `apps/auth/src/app.ts`), so an origin
 * missing here cannot sign in and cannot call auth at all. The second web and
 * admin hosts are appended, never substituted: the primary hosts keep serving
 * already shipped clients.
 */
function buildAllowedRedirectUris(props: AuthGatewayProps): string {
  return [
    props.baseDomain,
    `app.${props.baseDomain}`,
    `admin.${props.baseDomain}`,
    props.webAdditionalHost,
    props.adminAdditionalHost,
  ]
    .map((host) => normalizeHost(host))
    .filter((host): host is string => host !== undefined)
    .map((host) => `https://${host}`)
    .join(",");
}

export interface AuthGatewayResult {
  restApi: apigw.RestApi;
  authFn: lambdaNodejs.NodejsFunction;
  accessLogGroup: logs.LogGroup;
}

export interface AuthGatewayErrorResponseHeaders {
  readonly [headerName: string]: string;
  readonly "Access-Control-Allow-Origin": string;
  readonly Vary: string;
  readonly "Access-Control-Allow-Headers": string;
  readonly "Access-Control-Allow-Methods": string;
  readonly "Access-Control-Allow-Credentials": string;
  readonly "Access-Control-Expose-Headers": string;
  readonly "X-Request-Id": string;
}

const authCorsAllowHeaders = [
  "content-type",
  "authorization",
  "x-csrf-token",
  "sentry-trace",
  "baggage",
] as const;

const authGatewayErrorCorsExposeHeaders = [
  "retry-after",
  "x-request-id",
  "x-amzn-requestid",
  "x-amz-apigw-id",
] as const;

export function createAuthGatewayErrorResponseHeaders(): AuthGatewayErrorResponseHeaders {
  return {
    "Access-Control-Allow-Origin": "method.request.header.Origin",
    "Vary": "'Origin'",
    "Access-Control-Allow-Headers": `'${authCorsAllowHeaders.join(",")}'`,
    "Access-Control-Allow-Methods": "'GET,POST,OPTIONS'",
    "Access-Control-Allow-Credentials": "'true'",
    "Access-Control-Expose-Headers": `'${authGatewayErrorCorsExposeHeaders.join(",")}'`,
    "X-Request-Id": "context.requestId",
  };
}

function addLambdaSecretArnEnvironment(
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
  fn.addEnvironment(environmentVariableName, secret.secretArn);
}

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function addOptionalSentryEnvironment(
  scope: Construct,
  fn: lambdaNodejs.NodejsFunction,
  props: AuthGatewayProps,
): void {
  if (!hasConfiguredValue(props.sentryDsnSecretArn)) {
    return;
  }
  if (
    !hasConfiguredValue(props.sentryEnvironment) ||
    !hasConfiguredValue(props.sentryRelease) ||
    !hasConfiguredValue(props.sentryTracesSampleRate)
  ) {
    throw new Error("sentryEnvironment, sentryRelease, and sentryTracesSampleRate are required when sentryDsnSecretArn is configured");
  }

  const tracesSampleRate = Number(props.sentryTracesSampleRate);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }

  const secret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
    scope,
    "AuthHandlerSentryDsnSecret",
    props.sentryDsnSecretArn,
  );
  secret.grantRead(fn);
  fn.addEnvironment("SENTRY_DSN", secret.secretValue.unsafeUnwrap());
  fn.addEnvironment("SENTRY_ENVIRONMENT", props.sentryEnvironment);
  fn.addEnvironment("SENTRY_RELEASE", props.sentryRelease);
  fn.addEnvironment("SENTRY_TRACES_SAMPLE_RATE", props.sentryTracesSampleRate);
}

const lambdaBundling: lambdaNodejs.BundlingOptions = {
  minify: true,
  sourceMap: true,
  commandHooks: {
    beforeBundling: () => [],
    beforeInstall: () => [],
    afterBundling: (_inputDir: string, outputDir: string) => [
      createRdsCaBundleDownloadCommand(outputDir),
    ],
  },
};

export function authGateway(scope: Construct, props: AuthGatewayProps): AuthGatewayResult {
  const publicApiOrigin = parsePublicOrigin(
    props.apiBaseUrl ?? `https://api.${props.baseDomain}`,
    "apiBaseUrl",
  );
  const sessionEncryptionKey = new cdk.aws_secretsmanager.Secret(scope, "SessionEncryptionKey", {
    secretName: "flashcards-open-source-app/session-encryption-key",
    generateSecretString: {
      passwordLength: 64,
      includeSpace: false,
      excludeUppercase: true,
      excludePunctuation: true,
      excludeCharacters: "ghijklmnopqrstuvwxyz",
      requireEachIncludedType: false,
    },
  });

  const oidcSigningKey = new kms.Key(scope, "OidcSigningKey", {
    keySpec: kms.KeySpec.RSA_2048,
    keyUsage: kms.KeyUsage.SIGN_VERIFY,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    description: "Signs Nibomo OIDC ID tokens; private key never leaves KMS",
  });

  const authFn = new lambdaNodejs.NodejsFunction(scope, "AuthHandler", {
    entry: resolveFromRepoRoot("apps", "auth", "src", "lambda.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    // Share of the Postgres connection budget documented in ../lambda-database-capacity.ts.
    reservedConcurrentExecutions: authHandlerReservedConcurrency,
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [props.lambdaSg],
    ...authNodejsProjectPaths,
    bundling: lambdaBundling,
    environment: {
      NODE_EXTRA_CA_CERTS: "/var/task/rds-global-bundle.pem",
      DB_SECRET_ARN: props.authDbSecret.secretArn,
      DB_HOST: props.db.dbInstanceEndpointAddress,
      DB_NAME: "flashcards",
      [databasePoolMaxConnectionsEnvName]: databasePoolMaxConnectionsEnvValue,
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      OIDC_SIGNING_KEY_ARN: oidcSigningKey.keyArn,
      ALLOWED_REDIRECT_URIS: buildAllowedRedirectUris(props),
      COOKIE_DOMAIN: buildCookieDomains(props),
      // The OAuth issuer this authorization server publishes in its RFC 8414
      // metadata and echoes as the RFC 9207 `iss` parameter
      // (apps/auth/src/routes/oauth/metadata.ts,
      // apps/auth/src/routes/oauth/authorize.ts). Shipped MCP clients compare it,
      // and the backend names the same string in every protected-resource
      // document (apps/backend/src/entrypoints/lambda-mcp.ts), so it is pinned to
      // baseDomain and has no override.
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      PUBLIC_API_BASE_URL: `${publicApiOrigin}/v1`,
      // Canonical MCP protected-resource identifier the /authorize endpoint binds
      // authorization codes to; must match the backend MCP handler's resource
      // (apps/backend/src/mcp/hosts.ts). Built from the shared helper rather than
      // spelled out, so the primary and the alternate identifier cannot drift
      // apart and silently break the audience match.
      MCP_RESOURCE: getMcpResourceUrl(getPrimaryMcpHost(props.baseDomain)),
      // The second MCP host's identifier, so /authorize also mints tokens for a
      // client that reached that host. A token stays valid only on the host its
      // resource names. Absent unless the alternate host is deployed.
      ...(props.mcpAlternateHost === undefined
        ? {}
        : { MCP_ALTERNATE_RESOURCE: getMcpResourceUrl(props.mcpAlternateHost) }),
    },
  });

  oidcSigningKey.grant(authFn, "kms:Sign", "kms:GetPublicKey");
  sessionEncryptionKey.grantRead(authFn);
  props.authDbSecret.grantRead(authFn);
  addOptionalSentryEnvironment(scope, authFn, props);
  authFn.addEnvironment(
    "SESSION_ENCRYPTION_KEY",
    sessionEncryptionKey.secretValue.unsafeUnwrap(),
  );

  if (props.demoEmailDostip !== undefined && props.demoEmailDostip !== "") {
    authFn.addEnvironment("DEMO_EMAIL_DOSTIP", props.demoEmailDostip);
  }

  addLambdaSecretArnEnvironment(
    scope,
    authFn,
    props.demoPasswordSecretArn,
    "DemoPasswordSecret",
    "DEMO_PASSWORD_SECRET_ARN",
  );
  const accessLogGroup = new logs.LogGroup(scope, "AuthApiAccessLogGroup", {
    retention: logs.RetentionDays.ONE_WEEK,
  });

  const restApi = new apigw.RestApi(scope, "AuthApi", {
    restApiName: "flashcards-open-source-app-auth",
    description: "Public auth API for flashcards web sign-in",
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 20,
      throttlingBurstLimit: 40,
      metricsEnabled: true,
      dataTraceEnabled: false,
      tracingEnabled: false,
      accessLogDestination: new apigw.LogGroupLogDestination(accessLogGroup),
      accessLogFormat: createSafeApiGatewayAccessLogFormat(),
    },
  });

  const integration = new apigw.LambdaIntegration(authFn);
  restApi.root.addMethod("ANY", integration);
  restApi.root.addResource("{proxy+}").addMethod("ANY", integration);
  const gatewayErrorResponseHeaders = createAuthGatewayErrorResponseHeaders();

  new apigw.GatewayResponse(scope, "AuthApiDefault4xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_4XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  new apigw.GatewayResponse(scope, "AuthApiDefault5xxGatewayResponse", {
    restApi,
    type: apigw.ResponseType.DEFAULT_5XX,
    responseHeaders: gatewayErrorResponseHeaders,
  });

  if (props.authCertificateArn) {
    const authDomainName = `auth.${props.baseDomain}`;
    const certificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "AuthCertificate",
      props.authCertificateArn,
    );

    const domain = restApi.addDomainName("AuthCustomDomain", {
      domainName: authDomainName,
      certificate,
      endpointType: apigw.EndpointType.REGIONAL,
    });

    new cdk.CfnOutput(scope, "AuthCustomDomainTarget", {
      value: domain.domainNameAliasDomainName,
      description: "Create a Cloudflare CNAME for auth.<domain> to this target",
    });
  }

  // Additive second host for the same auth API: the primary auth.<baseDomain>
  // domain above is created regardless of this block.
  if (props.authAlternateHost !== undefined && hasConfiguredValue(props.authAlternateCertificateArn)) {
    const alternateCertificate = cdk.aws_certificatemanager.Certificate.fromCertificateArn(
      scope,
      "AuthAlternateCertificate",
      props.authAlternateCertificateArn,
    );

    const alternateDomain = restApi.addDomainName("AuthAlternateCustomDomain", {
      domainName: props.authAlternateHost,
      certificate: alternateCertificate,
      endpointType: apigw.EndpointType.REGIONAL,
    });

    new cdk.CfnOutput(scope, "AuthAlternateCustomDomainTarget", {
      value: alternateDomain.domainNameAliasDomainName,
      description: "Create a CNAME for the alternate auth host to this target",
    });
  }

  return { restApi, authFn, accessLogGroup };
}
