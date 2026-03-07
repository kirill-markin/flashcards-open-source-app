import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface OutputsProps {
  baseDomain: string;
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  appDbSecret: cdk.aws_secretsmanager.Secret;
  alertTopic: sns.Topic;
  restApi: apigw.RestApi;
  authRestApi: apigw.RestApi;
  backendFn: lambda.IFunction;
  authFn: lambda.IFunction;
  migrationFn: lambda.IFunction;
  userPoolId: string;
  userPoolClientId: string;
  webBucket: s3.IBucket;
  webDistribution: cloudfront.Distribution;
  webCustomDomain: string | undefined;
}

export function outputs(scope: Construct, props: OutputsProps): void {
  new cdk.CfnOutput(scope, "ApiGatewayUrl", {
    value: props.restApi.url,
    description: "API Gateway invoke URL",
  });

  new cdk.CfnOutput(scope, "ApiPublicBase", {
    value: `https://api.${props.baseDomain}/v1`,
    description: "Expected public API base URL when custom domain is configured",
  });

  new cdk.CfnOutput(scope, "ApiGatewayId", {
    value: props.restApi.restApiId,
    description: "REST API ID",
  });

  new cdk.CfnOutput(scope, "AuthGatewayUrl", {
    value: props.authRestApi.url,
    description: "Auth API Gateway invoke URL",
  });

  new cdk.CfnOutput(scope, "AuthPublicBase", {
    value: `https://auth.${props.baseDomain}`,
    description: "Expected public auth base URL when custom domain is configured",
  });

  new cdk.CfnOutput(scope, "AuthGatewayId", {
    value: props.authRestApi.restApiId,
    description: "Auth REST API ID",
  });

  new cdk.CfnOutput(scope, "DbEndpoint", {
    value: props.db.dbInstanceEndpointAddress,
    description: "RDS endpoint (private)",
  });

  new cdk.CfnOutput(scope, "DbOwnerSecretArn", {
    value: props.dbOwnerSecret.secretArn,
    description: "Secrets Manager ARN for DB owner credentials",
  });

  new cdk.CfnOutput(scope, "AppDbSecretArn", {
    value: props.appDbSecret.secretArn,
    description: "Secrets Manager ARN for app role credentials",
  });

  new cdk.CfnOutput(scope, "BackendFunctionName", {
    value: props.backendFn.functionName,
    description: "Lambda function name for API backend",
  });

  new cdk.CfnOutput(scope, "AuthFunctionName", {
    value: props.authFn.functionName,
    description: "Lambda function name for auth backend",
  });

  new cdk.CfnOutput(scope, "DbMigrationFunctionName", {
    value: props.migrationFn.functionName,
    description: "Lambda function name for database migrations",
  });

  new cdk.CfnOutput(scope, "AlertTopicArn", {
    value: props.alertTopic.topicArn,
    description: "SNS topic for alarms",
  });

  new cdk.CfnOutput(scope, "CognitoUserPoolId", {
    value: props.userPoolId,
    description: "Cognito User Pool ID",
  });

  new cdk.CfnOutput(scope, "CognitoClientId", {
    value: props.userPoolClientId,
    description: "Cognito App Client ID",
  });

  new cdk.CfnOutput(scope, "WebBucketName", {
    value: props.webBucket.bucketName,
    description: "S3 bucket for deployed web assets",
  });

  new cdk.CfnOutput(scope, "WebDistributionId", {
    value: props.webDistribution.distributionId,
    description: "CloudFront distribution ID for the web app",
  });

  new cdk.CfnOutput(scope, "WebDistributionDomainName", {
    value: props.webDistribution.domainName,
    description: "CloudFront distribution domain name for the web app",
  });

  new cdk.CfnOutput(scope, "WebPublicBase", {
    value: props.webCustomDomain === undefined
      ? `https://${props.webDistribution.domainName}`
      : `https://${props.webCustomDomain}`,
    description: "Public base URL for the web app",
  });

  if (props.webCustomDomain !== undefined) {
    new cdk.CfnOutput(scope, "WebCustomDomainTarget", {
      value: props.webDistribution.domainName,
      description: "Create a Cloudflare CNAME for app.<domain> to this target",
    });
  }
}
