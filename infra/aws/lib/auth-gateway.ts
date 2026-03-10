import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export interface AuthGatewayProps {
  vpc: ec2.Vpc;
  lambdaSg: ec2.SecurityGroup;
  db: rds.DatabaseInstance;
  appDbSecret: cdk.aws_secretsmanager.Secret;
  baseDomain: string;
  authCertificateArn: string | undefined;
  userPoolId: string;
  userPoolClientId: string;
}

export interface AuthGatewayResult {
  restApi: apigw.RestApi;
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
    entry: path.join(__dirname, "../../../apps/auth/src/lambda.ts"),
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
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(scope).region,
      ALLOWED_REDIRECT_URIS: `https://${props.baseDomain},https://app.${props.baseDomain}`,
      COOKIE_DOMAIN: props.baseDomain,
      PUBLIC_AUTH_BASE_URL: `https://auth.${props.baseDomain}`,
      PUBLIC_API_BASE_URL: `https://api.${props.baseDomain}/v1`,
    },
  });

  sessionEncryptionKey.grantRead(authFn);
  props.appDbSecret.grantRead(authFn);
  authFn.addEnvironment(
    "SESSION_ENCRYPTION_KEY",
    sessionEncryptionKey.secretValue.unsafeUnwrap(),
  );

  const restApi = new apigw.RestApi(scope, "AuthApi", {
    restApiName: "flashcards-open-source-app-auth",
    description: "Public auth API for flashcards web sign-in",
    deployOptions: {
      stageName: "v1",
      throttlingRateLimit: 20,
      throttlingBurstLimit: 40,
    },
  });

  const integration = new apigw.LambdaIntegration(authFn);
  restApi.root.addProxy({
    defaultIntegration: integration,
    anyMethod: true,
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

  return { restApi, authFn };
}
