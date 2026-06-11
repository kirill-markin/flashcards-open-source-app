import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { createSafeApiGatewayAccessLogFormat } from "./api-gateway-access-log";
import { authNodejsProjectPaths, resolveFromRepoRoot } from "../nodejs-project-paths";

export interface AuthGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  authDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  authCertificateArn: string | undefined;
  demoEmailDostip: string | undefined;
  demoPasswordSecretArn: string | undefined;
  userPoolId: string;
  userPoolClientId: string;
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

export function authGateway(scope: Construct, props: AuthGatewayProps): AuthGatewayResult {
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

  const authFn = new lambdaNodejs.NodejsFunction(scope, "AuthHandler", {
    entry: resolveFromRepoRoot("apps", "auth", "src", "lambda.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
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
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      ALLOWED_REDIRECT_URIS: `https://${props.baseDomain},https://app.${props.baseDomain},https://admin.${props.baseDomain}`,
      COOKIE_DOMAIN: props.baseDomain,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
    },
  });

  sessionEncryptionKey.grantRead(authFn);
  props.authDbSecret.grantRead(authFn);
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

  return { restApi, authFn, accessLogGroup };
}
