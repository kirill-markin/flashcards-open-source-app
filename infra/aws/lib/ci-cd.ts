import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { Construct } from "constructs";
import { geoLiteAsnObjectKey, geoLiteCountryObjectKey } from "./geolite-country";

export interface CiCdProps {
  stackId: string;
  geoLiteCountryBucket: s3.IBucket;
  githubRepo: string;
  githubOidcProviderArn: string | undefined;
  authFn: lambda.IFunction;
  nativeProofGateFn: lambda.IFunction;
  demoPasswordSecretArn: string | undefined;
  globalMetricsSnapshotFn: lambda.IFunction;
  globalMetricsSnapshotFreshnessCheckerFn: lambda.IFunction;
  communityLeaderboardSnapshotFn: lambda.IFunction;
  streakLeaderboardSnapshotFn: lambda.IFunction;
  progressActiveDaysBackfillFn: lambda.IFunction;
  webGuestReaperFn: lambda.IFunction;
  catalogDumpFn: lambda.IFunction;
  migrationFn: lambda.IFunction;
  generatedMediaPromotionScheduleArn: string;
  multipartCompletionReconciliationScheduleArn: string;
  userPoolArn: string;
  webBucket: s3.IBucket;
  webDistribution: cloudfront.Distribution;
  adminBucket: s3.IBucket;
  adminDistribution: cloudfront.Distribution;
}

export function createMultipartCompletionReconciliationScheduleReadStatement(
  scheduleArn: string,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "ReadMultipartCompletionReconciliationSchedule",
    actions: ["scheduler:GetSchedule"],
    resources: [scheduleArn],
  });
}

export function createGeneratedMediaPromotionScheduleReadStatement(
  scheduleArn: string,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "ReadGeneratedMediaPromotionSchedule",
    actions: ["scheduler:GetSchedule"],
    resources: [scheduleArn],
  });
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

  const geoLiteObjectArns = [
    props.geoLiteCountryBucket.arnForObjects(geoLiteCountryObjectKey),
    props.geoLiteCountryBucket.arnForObjects(geoLiteAsnObjectKey),
  ];
  const geoLiteStatements = [
    new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: geoLiteObjectArns,
    }),
    new iam.PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: [props.stackId],
    }),
  ];
  new iam.Role(scope, "GeoLiteRefreshRole", {
    roleName: "flashcards-open-source-app-geolite-refresh",
    assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:ref:refs/heads/main`,
      },
    }),
    inlinePolicies: { RefreshCountryDatabase: new iam.PolicyDocument({ statements: geoLiteStatements }) },
  });

  const cdkDeployStatements: iam.PolicyStatement[] = [
    ...geoLiteStatements,
    new iam.PolicyStatement({
      sid: "ReadPublishedGeoLiteDatabases",
      actions: ["s3:GetObject"],
      resources: geoLiteObjectArns,
    }),
    // Without it S3 answers an absent object with AccessDenied, so the release gate could not refresh it.
    new iam.PolicyStatement({
      sid: "ListGeoLiteBucket",
      actions: ["s3:ListBucket"],
      resources: [props.geoLiteCountryBucket.bucketArn],
    }),
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
      sid: "InvokeNativeProofGate",
      actions: ["lambda:InvokeFunction"],
      resources: [props.nativeProofGateFn.functionArn],
    }),
    createGeneratedMediaPromotionScheduleReadStatement(
      props.generatedMediaPromotionScheduleArn,
    ),
    createMultipartCompletionReconciliationScheduleReadStatement(
      props.multipartCompletionReconciliationScheduleArn,
    ),
    new iam.PolicyStatement({
      sid: "ReadPatchedNodeFunctionInventory",
      actions: ["cloudformation:ListStackResources"],
      resources: [props.stackId],
    }),
    new iam.PolicyStatement({
      sid: "ReadPatchedNodeConfigurations",
      actions: ["lambda:GetFunctionConfiguration"],
      resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${cdk.Stack.of(scope).stackName}-*`],
    }),
    new iam.PolicyStatement({
      sid: "ReadPatchedNodeLayers",
      actions: ["lambda:GetLayerVersion"],
      resources: cdk.Lazy.list({
        produce: () => scope.node.findAll()
          .filter((node): node is lambda.LayerVersion =>
            node instanceof lambda.LayerVersion && node.stack === cdk.Stack.of(scope))
          .map((layer) => layer.layerVersionArn),
      }),
    }),
    new iam.PolicyStatement({
      sid: "ReadPatchedNodeStartupEvidence",
      actions: ["logs:FilterLogEvents"],
      resources: [
        `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${cdk.Stack.of(scope).stackName}-*:*`,
        `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:${cdk.Stack.of(scope).stackName}-*:*`,
      ],
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
    new iam.PolicyStatement({
      sid: "DeployAdminAssets",
      actions: [
        "s3:GetBucketLocation",
        "s3:ListBucket",
      ],
      resources: [props.adminBucket.bucketArn],
    }),
    new iam.PolicyStatement({
      sid: "DeployAdminObjects",
      actions: [
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:PutObject",
      ],
      resources: [`${props.adminBucket.bucketArn}/*`],
    }),
    new iam.PolicyStatement({
      sid: "InvalidateAdminDistribution",
      actions: ["cloudfront:CreateInvalidation"],
      resources: [props.adminDistribution.distributionArn],
    }),
    // Per-component release bookkeeping read and written by
    // .github/workflows/aws-web-release.yml.
    new iam.PolicyStatement({
      sid: "RecordDeployedReleaseShas",
      actions: ["ssm:DeleteParameter", "ssm:GetParameters", "ssm:PutParameter"],
      resources: ["platform", "web", "admin"].map((component) =>
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/${cdk.Stack.of(scope).stackName}/release/deployed-sha/${component}`
      ),
    }),
    // Authenticated public.ecr.aws pulls for the PostgreSQL integration checks in
    // .github/workflows/aws-web-release.yml; neither action supports resource scoping.
    new iam.PolicyStatement({
      sid: "PullEcrPublicImagesAuthenticated",
      actions: ["ecr-public:GetAuthorizationToken", "sts:GetServiceBearerToken"],
      resources: ["*"],
    }),
  ];

  if (props.demoPasswordSecretArn !== undefined) {
    cdkDeployStatements.push(new iam.PolicyStatement({
      sid: "ReadDemoPasswordSecret",
      actions: ["secretsmanager:GetSecretValue"],
      resources: [props.demoPasswordSecretArn],
    }));
  }

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeGlobalMetricsSnapshotLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.globalMetricsSnapshotFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeGlobalMetricsSnapshotFreshnessCheckerLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.globalMetricsSnapshotFreshnessCheckerFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeCommunityLeaderboardSnapshotLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.communityLeaderboardSnapshotFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeStreakLeaderboardSnapshotLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.streakLeaderboardSnapshotFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeProgressActiveDaysBackfillLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.progressActiveDaysBackfillFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeWebGuestReaperLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.webGuestReaperFn.functionArn],
  }));

  cdkDeployStatements.push(new iam.PolicyStatement({
    sid: "InvokeCatalogDumpLambda",
    actions: ["lambda:InvokeFunction"],
    resources: [props.catalogDumpFn.functionArn],
  }));

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
        statements: cdkDeployStatements,
      }),
    },
  });

  new cdk.CfnOutput(scope, "GithubDeployRoleArn", {
    value: deployRole.roleArn,
    description: "IAM role ARN for GitHub Actions deployment",
  });
}
