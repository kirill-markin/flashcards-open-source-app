import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface CiCdProps {
  stackId: string;
  workerFn: lambda.IFunction;
  githubRepo: string;
}

export function ciCd(scope: Construct, props: CiCdProps): void {
  const oidcProvider = new iam.OpenIdConnectProvider(scope, "GithubOidc", {
    url: "https://token.actions.githubusercontent.com",
    clientIds: ["sts.amazonaws.com"],
  });

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
            sid: "InvokeWorker",
            actions: ["lambda:InvokeFunction"],
            resources: [props.workerFn.functionArn],
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
