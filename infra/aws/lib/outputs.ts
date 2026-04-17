import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface OutputsProps {
  baseDomain: string;
  db: rds.DatabaseInstance;
  dbOwnerSecret: cdk.aws_secretsmanager.ISecret;
  backendDbSecret: cdk.aws_secretsmanager.Secret;
  authDbSecret: cdk.aws_secretsmanager.Secret;
  reportingDbSecret: cdk.aws_secretsmanager.ISecret;
  alertTopic: sns.Topic;
  restApi: apigw.RestApi;
  authRestApi: apigw.RestApi;
  backendFn: lambda.IFunction;
  chatWorkerFn: lambda.IFunction;
  chatLiveFn: lambda.IFunction;
  authFn: lambda.IFunction;
  migrationFn: lambda.IFunction;
  userPoolId: string;
  userPoolClientId: string;
  webBucket: s3.IBucket;
  webDistribution: cloudfront.Distribution;
  webCustomDomain: string | undefined;
  adminBucket: s3.IBucket;
  adminDistribution: cloudfront.Distribution;
  adminCustomDomain: string | undefined;
  apexRedirectDistribution: cloudfront.Distribution | undefined;
  apexRedirectCustomDomain: string | undefined;
  dbAccessInstance?: ec2.Instance;
  analyticsSshUsername?: string;
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

  new cdk.CfnOutput(scope, "BackendDbSecretArn", {
    value: props.backendDbSecret.secretArn,
    description: "Secrets Manager ARN for backend database role credentials",
  });

  new cdk.CfnOutput(scope, "AuthDbSecretArn", {
    value: props.authDbSecret.secretArn,
    description: "Secrets Manager ARN for auth database role credentials",
  });

  new cdk.CfnOutput(scope, "BackendFunctionName", {
    value: props.backendFn.functionName,
    description: "Lambda function name for API backend",
  });

  new cdk.CfnOutput(scope, "ChatWorkerFunctionName", {
    value: props.chatWorkerFn.functionName,
    description: "Lambda function name for detached chat worker",
  });

  new cdk.CfnOutput(scope, "ChatLiveFunctionName", {
    value: props.chatLiveFn.functionName,
    description: "Lambda function name for SSE live chat stream",
  });

  new cdk.CfnOutput(scope, "AuthFunctionName", {
    value: props.authFn.functionName,
    description: "Lambda function name for auth backend",
  });

  new cdk.CfnOutput(scope, "DbMigrationFunctionName", {
    value: props.migrationFn.functionName,
    description: "Lambda function name for database migrations",
  });

  if (props.dbAccessInstance !== undefined) {
    new cdk.CfnOutput(scope, "AnalyticsSshHost", {
      value: props.dbAccessInstance.instancePublicDnsName,
      description: "Public DNS name of the analytical SSH bastion host",
    });

    new cdk.CfnOutput(scope, "AnalyticsSshPort", {
      value: "22",
      description: "SSH port for the analytical bastion host",
    });
  }

  if (props.analyticsSshUsername !== undefined) {
    new cdk.CfnOutput(scope, "AnalyticsSshUsername", {
      value: props.analyticsSshUsername,
      description: "SSH username for the analytical bastion host",
    });
  }

  new cdk.CfnOutput(scope, "ReportingDbSecretArn", {
    value: props.reportingDbSecret.secretArn,
    description: "Secrets Manager ARN for reporting_readonly credentials",
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

  new cdk.CfnOutput(scope, "AdminBucketName", {
    value: props.adminBucket.bucketName,
    description: "S3 bucket for deployed admin assets",
  });

  new cdk.CfnOutput(scope, "AdminDistributionId", {
    value: props.adminDistribution.distributionId,
    description: "CloudFront distribution ID for the admin app",
  });

  new cdk.CfnOutput(scope, "AdminDistributionDomainName", {
    value: props.adminDistribution.domainName,
    description: "CloudFront distribution domain name for the admin app",
  });

  if (props.adminCustomDomain !== undefined) {
    new cdk.CfnOutput(scope, "AdminPublicBase", {
      value: `https://${props.adminCustomDomain}`,
      description: "Supported public admin URL for the admin app",
    });

    new cdk.CfnOutput(scope, "AdminCustomDomainTarget", {
      value: props.adminDistribution.domainName,
      description: "Create a Cloudflare CNAME for admin.<domain> to this target",
    });
  }

  if (
    props.apexRedirectDistribution !== undefined &&
    props.apexRedirectCustomDomain !== undefined
  ) {
    new cdk.CfnOutput(scope, "ApexRedirectCustomDomainTarget", {
      value: props.apexRedirectDistribution.domainName,
      description: "Create a Cloudflare CNAME for the apex domain to this redirect target",
    });
  }
}
