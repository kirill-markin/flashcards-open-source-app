import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { Construct } from "constructs";

export interface CiCdProps {
  stackId: string;
  githubRepo: string;
  githubOidcProviderArn: string | undefined;
  authFn: lambda.IFunction;
  migrationFn: lambda.IFunction;
  userPoolArn: string;
  webBucket: s3.IBucket;
  webDistribution: cloudfront.Distribution;
}

export function ciCd(scope: Construct, props: CiCdProps): void {
  const oidcProvider = props.githubOidcProviderArn === undefined
    ? new iam.OpenIdConnectProvider(scope, "GithubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    })
    : iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      scope,
      "GithubOidc",
      props.githubOidcProviderArn,
    );

  const deployRole = new iam.Role(scope, "GithubActionsRole", {
    roleName: "flashcards-open-source-app-github-deploy",
    assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
      StringLike: {
        "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:ref:refs/heads/main`,
      },
    }),
    inlinePolicies: {
      CdkDeploy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "AssumeCdkRoles",
            actions: ["sts:AssumeRole"],
            resources: [`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-*`],
          }),
          new iam.PolicyStatement({
            sid: "ReadStackOutputs",
            actions: ["cloudformation:DescribeStacks"],
            resources: [props.stackId],
          }),
          new iam.PolicyStatement({
            sid: "InvokeMigrationLambda",
            actions: ["lambda:InvokeFunction"],
            resources: [props.migrationFn.functionArn],
          }),
          new iam.PolicyStatement({
            sid: "ReadAuthLambdaConfiguration",
            actions: ["lambda:GetFunctionConfiguration"],
            resources: [props.authFn.functionArn],
          }),
          new iam.PolicyStatement({
            sid: "ReadCognitoDemoUserState",
            actions: [
              "cognito-idp:DescribeUserPool",
              "cognito-idp:ListUsers",
            ],
            resources: [props.userPoolArn],
          }),
          new iam.PolicyStatement({
            sid: "DeployWebAssets",
            actions: [
              "s3:GetBucketLocation",
              "s3:ListBucket",
            ],
            resources: [props.webBucket.bucketArn],
          }),
          new iam.PolicyStatement({
            sid: "DeployWebObjects",
            actions: [
              "s3:DeleteObject",
              "s3:GetObject",
              "s3:PutObject",
            ],
            resources: [`${props.webBucket.bucketArn}/*`],
          }),
          new iam.PolicyStatement({
            sid: "InvalidateWebDistribution",
            actions: ["cloudfront:CreateInvalidation"],
            resources: [props.webDistribution.distributionArn],
          }),
        ],
      }),
    },
  });

  new cdk.CfnOutput(scope, "GithubDeployRoleArn", {
    value: deployRole.roleArn,
    description: "IAM role ARN for GitHub Actions deployment",
  });
}
