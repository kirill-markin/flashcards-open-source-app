import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface OutputsProps {
  baseDomain: string;
  db: rds.DatabaseInstance;
  appDbSecret: cdk.aws_secretsmanager.Secret;
  alertTopic: sns.Topic;
  restApi: apigw.RestApi;
  backendFn: lambda.IFunction;
  userPoolId: string;
  userPoolClientId: string;
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

  new cdk.CfnOutput(scope, "DbEndpoint", {
    value: props.db.dbInstanceEndpointAddress,
    description: "RDS endpoint (private)",
  });

  new cdk.CfnOutput(scope, "DbOwnerSecretArn", {
    value: props.db.secret?.secretArn ?? "N/A",
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
}
