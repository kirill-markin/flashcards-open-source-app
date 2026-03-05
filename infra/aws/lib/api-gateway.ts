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
  userPoolId: string;
  userPoolClientId: string;
}

export interface ApiGatewayResult {
  restApi: apigw.RestApi;
  backendFn: lambdaNodejs.NodejsFunction;
  authFn: lambdaNodejs.NodejsFunction;
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

export function apiGateway(scope: Construct, props: ApiGatewayProps): ApiGatewayResult {
  const backendFn = new lambdaNodejs.NodejsFunction(scope, "BackendHandler", {
    entry: path.join(__dirname, "../../../apps/backend/src/handler.ts"),
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
    },
  });

  props.appDbSecret.grantRead(backendFn);

  // Session encryption key for auth service OTP cookies
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
    entry: path.join(__dirname, "../../../apps/auth/src/lambda.ts"),
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: cdk.Duration.seconds(30),
    memorySize: 256,
    bundling: { minify: true, sourceMap: true },
    environment: {
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      ALLOWED_REDIRECT_URIS: `https://${props.baseDomain},https://app.${props.baseDomain}`,
      COOKIE_DOMAIN: props.baseDomain,
    },
  });

  sessionEncryptionKey.grantRead(authFn);
  // Inject the secret value as SESSION_ENCRYPTION_KEY env var at deploy time
  authFn.addEnvironment(
    "SESSION_ENCRYPTION_KEY",
    sessionEncryptionKey.secretValue.unsafeUnwrap(),
  );

  const restApi = new apigw.RestApi(scope, "Api", {
    restApiName: "flashcards-open-source-app-api",
    description: "Public API for flashcards mobile clients",
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    },
    defaultCorsPreflightOptions: {
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
    },
  });

  const integration = new apigw.LambdaIntegration(backendFn);

  const health = restApi.root.addResource("health");
  health.addMethod("GET", integration);

  const sync = restApi.root.addResource("sync");
  sync.addResource("push").addMethod("POST", integration);
  sync.addResource("pull").addMethod("POST", integration);

  // Auth Lambda routes under /auth/{proxy+}
  const authIntegration = new apigw.LambdaIntegration(authFn);
  const authResource = restApi.root.addResource("auth");
  authResource.addProxy({
    defaultIntegration: authIntegration,
    anyMethod: true,
  });

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

  return { restApi, backendFn, authFn };
}
