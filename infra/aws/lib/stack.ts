import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { networking } from "./networking";
import { database } from "./database";
import { preSignUp } from "./pre-signup";
import { auth } from "./auth";
import { apiGateway } from "./gateways/api-gateway";
import { monitoring } from "./monitoring";
import { ciCd } from "./ci-cd";
import { backupPlan } from "./backup";
import { outputs } from "./outputs";
import { webApp } from "./web";
import { adminApp } from "./admin";
import { migrationRunner } from "./migration-runner";
import { authGateway } from "./gateways/auth-gateway";
import { mcpGateway } from "./gateways/mcp-gateway";
import { analyticsAccess, type AnalyticsAccessResult } from "./analytics-access";
import { globalMetrics } from "./global-metrics";
import { communityLeaderboard } from "./community-leaderboard";
import { streakLeaderboard } from "./streak-leaderboard";
import { progressActiveDaysBackfill } from "./progress-active-days-backfill";

function getOptionalContextValue(stack: cdk.Stack, key: string): string | undefined {
  const value = stack.node.tryGetContext(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? undefined : trimmedValue;
}

function getOptionalRawContextValue(stack: cdk.Stack, key: string): string | undefined {
  const value = stack.node.tryGetContext(key);
  if (typeof value !== "string" || value === "") {
    return undefined;
  }

  return value;
}

interface BackendSentryContext {
  sentryDsnSecretArn: string;
  sentryEnvironment: string;
  sentryRelease: string;
  sentryTracesSampleRate: string;
}

interface BackendSentryContextInput {
  sentryDsnSecretArn: string | undefined;
  sentryEnvironment: string | undefined;
  sentryRelease: string | undefined;
  sentryTracesSampleRate: string | undefined;
}

function hasConfiguredValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function validateSentryTracesSampleRate(value: string): void {
  const tracesSampleRate = Number(value);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    throw new Error("sentryTracesSampleRate must be a number between 0 and 1");
  }
}

function validateBackendSentryContext(context: BackendSentryContextInput): BackendSentryContext {
  const contextValues = [
    ["sentryDsnSecretArn", context.sentryDsnSecretArn],
    ["sentryEnvironment", context.sentryEnvironment],
    ["sentryRelease", context.sentryRelease],
    ["sentryTracesSampleRate", context.sentryTracesSampleRate],
  ] as const;
  const missingContextKeys = contextValues
    .filter(([_key, value]) => !hasConfiguredValue(value))
    .map(([key, _value]) => key);
  if (missingContextKeys.length > 0) {
    throw new Error(
      `Backend Sentry context is required for stack configuration because AWS Lambda backend runtimes require SENTRY_DSN. Missing: ${missingContextKeys.join(", ")}`,
    );
  }

  const { sentryDsnSecretArn, sentryEnvironment, sentryRelease, sentryTracesSampleRate } = context;
  if (
    !hasConfiguredValue(sentryDsnSecretArn) ||
    !hasConfiguredValue(sentryEnvironment) ||
    !hasConfiguredValue(sentryRelease) ||
    !hasConfiguredValue(sentryTracesSampleRate)
  ) {
    throw new Error("Backend Sentry context validation failed unexpectedly.");
  }

  validateSentryTracesSampleRate(sentryTracesSampleRate);
  return {
    sentryDsnSecretArn,
    sentryEnvironment,
    sentryRelease,
    sentryTracesSampleRate,
  };
}

function parseCommaSeparatedValue(value: string): ReadonlyArray<string> {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function parseLineSeparatedValue(value: string): ReadonlyArray<string> {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export class FlashcardsOpenSourceAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseDomain = this.node.tryGetContext("domainName") as string;
    const alertEmail = this.node.tryGetContext("alertEmail") as string;
    const githubRepo = this.node.tryGetContext("githubRepo") as string;
    const apiCertificateArn = getOptionalContextValue(this, "apiCertificateArn");
    const authCertificateArn = getOptionalContextValue(this, "authCertificateArn");
    const mcpCertificateArn = getOptionalContextValue(this, "mcpCertificateArn");
    const webCertificateArnUsEast1 = getOptionalContextValue(this, "webCertificateArnUsEast1");
    const adminCertificateArnUsEast1 = getOptionalContextValue(this, "adminCertificateArnUsEast1");
    const apexRedirectCertificateArnUsEast1 = getOptionalContextValue(this, "apexRedirectCertificateArnUsEast1");
    const githubOidcProviderArn = getOptionalContextValue(this, "githubOidcProviderArn");
    const openAiApiKeySecretArn = getOptionalContextValue(this, "openAiApiKeySecretArn");
    const langfusePublicKeySecretArn = getOptionalContextValue(this, "langfusePublicKeySecretArn");
    const langfuseSecretKeySecretArn = getOptionalContextValue(this, "langfuseSecretKeySecretArn");
    const langfuseBaseUrl = getOptionalContextValue(this, "langfuseBaseUrl");
    const sentryContext = validateBackendSentryContext({
      sentryDsnSecretArn: getOptionalContextValue(this, "sentryDsnSecretArn"),
      sentryEnvironment: getOptionalContextValue(this, "sentryEnvironment"),
      sentryRelease: getOptionalContextValue(this, "sentryRelease"),
      sentryTracesSampleRate: getOptionalContextValue(this, "sentryTracesSampleRate"),
    });
    const demoEmailDostip = getOptionalContextValue(this, "demoEmailDostip");
    const demoPasswordSecretArn = getOptionalContextValue(this, "demoPasswordSecretArn");
    const adminEmails = getOptionalContextValue(this, "adminEmails");
    const guestAiWeightedMonthlyTokenCap = getOptionalContextValue(this, "guestAiWeightedMonthlyTokenCap");
    const resendApiKeySecretArn = getOptionalContextValue(this, "resendApiKeySecretArn");
    const resendSenderEmail = getOptionalContextValue(this, "resendSenderEmail");
    const analyticsSshPublicKeysValue = getOptionalContextValue(this, "analyticsSshPublicKeys");
    const analyticsSshAllowedCidrsValue = getOptionalContextValue(this, "analyticsSshAllowedCidrs");
    const analyticsSshUsernameValue = getOptionalContextValue(this, "analyticsSshUsername");
    // When enabled, global stats are visible externally through the public snapshot endpoint.
    // When disabled, no client can fetch global stats from that endpoint.
    const rawGlobalMetricsVisible = getOptionalRawContextValue(this, "globalMetricsVisible");
    const globalMetricsVisible = rawGlobalMetricsVisible === "true";
    const analyticsAccessRequested =
      analyticsSshPublicKeysValue !== undefined ||
      analyticsSshAllowedCidrsValue !== undefined ||
      analyticsSshUsernameValue !== undefined;

    const net = networking(this);
    const dbResult = database(this, { vpc: net.vpc, dbSg: net.dbSg });
    const globalMetricsResult = globalMetrics(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      reportingDbSecret: dbResult.reportingDbSecret,
      ...sentryContext,
    });
    const communityLeaderboardResult = communityLeaderboard(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      ...sentryContext,
    });
    const streakLeaderboardResult = streakLeaderboard(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      ...sentryContext,
    });
    const progressActiveDaysBackfillResult = progressActiveDaysBackfill(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      ...sentryContext,
    });
    let analyticsAccessResult: AnalyticsAccessResult | undefined;
    if (analyticsAccessRequested) {
      if (analyticsSshPublicKeysValue === undefined) {
        throw new Error("analyticsSshPublicKeys is required when enabling analytical SSH access");
      }
      if (analyticsSshAllowedCidrsValue === undefined) {
        throw new Error("analyticsSshAllowedCidrs is required when enabling analytical SSH access");
      }
      if (analyticsSshUsernameValue === undefined) {
        throw new Error("analyticsSshUsername is required when enabling analytical SSH access");
      }

      const analyticsSshPublicKeys = parseLineSeparatedValue(analyticsSshPublicKeysValue);
      const analyticsSshAllowedCidrs = parseCommaSeparatedValue(analyticsSshAllowedCidrsValue);
      if (analyticsSshPublicKeys.length === 0) {
        throw new Error("analyticsSshPublicKeys must contain at least one public SSH key");
      }
      if (analyticsSshAllowedCidrs.length === 0) {
        throw new Error("analyticsSshAllowedCidrs must contain at least one CIDR entry");
      }

      analyticsAccessResult = analyticsAccess(this, {
        vpc: net.vpc,
        dbSg: net.dbSg,
        dbHost: dbResult.db.dbInstanceEndpointAddress,
        sshAllowedCidrs: analyticsSshAllowedCidrs,
        sshPublicKeys: analyticsSshPublicKeys,
        sshUsername: analyticsSshUsernameValue,
      });
    }
    const preSignUpFn = preSignUp(this);
    const authResult = auth(this, {
      preSignUpFn,
      resendApiKeySecretArn,
      resendSenderEmail,
    });
    const authApi = authGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      authDbSecret: dbResult.authDbSecret,
      baseDomain,
      authCertificateArn,
      demoEmailDostip,
      demoPasswordSecretArn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const mcpApi = mcpGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      baseDomain,
      mcpCertificateArn,
      ...sentryContext,
    });
    const migrationFn = migrationRunner(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      backendDbSecret: dbResult.backendDbSecret,
      authDbSecret: dbResult.authDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      adminEmails,
      ...sentryContext,
    });
    const api = apiGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      baseDomain,
      apiCertificateArn,
      openAiApiKeySecretArn,
      langfusePublicKeySecretArn,
      langfuseSecretKeySecretArn,
      langfuseBaseUrl,
      ...sentryContext,
      resendApiKeySecretArn,
      resendSenderEmail,
      demoEmailDostip,
      guestAiWeightedMonthlyTokenCap,
      globalMetricsVisible,
      globalMetricsSnapshotBucket: globalMetricsResult.snapshotBucket,
      globalMetricsSnapshotObjectKey: globalMetricsResult.snapshotObjectKey,
      userPoolId: authResult.userPool.userPoolId,
      userPoolArn: authResult.userPool.userPoolArn,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const web = webApp(this, {
      baseDomain,
      webCertificateArnUsEast1,
      apexRedirectCertificateArnUsEast1,
    });
    const admin = adminApp(this, {
      baseDomain,
      adminCertificateArnUsEast1,
    });

    const mon = monitoring(this, {
      alertEmail,
      db: dbResult.db,
      restApi: api.restApi,
      authRestApi: authApi.restApi,
      mcpRestApi: mcpApi.restApi,
      backendFn: api.backendFn,
      authFn: authApi.authFn,
      mcpFn: mcpApi.mcpFn,
      authApiAccessLogGroup: authApi.accessLogGroup,
      customEmailSenderFn: authResult.customEmailSenderFn,
      chatWorkerFn: api.chatWorkerFn,
      chatLiveFn: api.chatLiveFn,
      globalMetricsSnapshotFn: globalMetricsResult.snapshotFunction,
      communityLeaderboardSnapshotFn: communityLeaderboardResult.snapshotFunction,
      streakLeaderboardSnapshotFn: streakLeaderboardResult.snapshotFunction,
      progressActiveDaysBackfillFn: progressActiveDaysBackfillResult.backfillFunction,
    });

    ciCd(this, {
      stackId: this.stackId,
      githubRepo,
      githubOidcProviderArn,
      authFn: authApi.authFn,
      demoPasswordSecretArn,
      globalMetricsSnapshotFn: globalMetricsResult.snapshotFunction,
      globalMetricsSnapshotFreshnessCheckerFn: globalMetricsResult.snapshotFreshnessCheckerFunction,
      communityLeaderboardSnapshotFn: communityLeaderboardResult.snapshotFunction,
      streakLeaderboardSnapshotFn: streakLeaderboardResult.snapshotFunction,
      progressActiveDaysBackfillFn: progressActiveDaysBackfillResult.backfillFunction,
      migrationFn,
      userPoolArn: authResult.userPool.userPoolArn,
      webBucket: web.bucket,
      webDistribution: web.distribution,
      adminBucket: admin.bucket,
      adminDistribution: admin.distribution,
    });

    backupPlan(this, { db: dbResult.db });

    outputs(this, {
      baseDomain,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      backendDbSecret: dbResult.backendDbSecret,
      authDbSecret: dbResult.authDbSecret,
      alertTopic: mon.alertTopic,
      restApi: api.restApi,
      authRestApi: authApi.restApi,
      mcpRestApi: mcpApi.restApi,
      backendFn: api.backendFn,
      chatWorkerFn: api.chatWorkerFn,
      chatLiveFn: api.chatLiveFn,
      authFn: authApi.authFn,
      mcpFn: mcpApi.mcpFn,
      migrationFn,
      globalMetricsSnapshotFunction: globalMetricsResult.snapshotFunction,
      globalMetricsSnapshotFreshnessCheckerFunction: globalMetricsResult.snapshotFreshnessCheckerFunction,
      communityLeaderboardSnapshotFunction: communityLeaderboardResult.snapshotFunction,
      streakLeaderboardSnapshotFunction: streakLeaderboardResult.snapshotFunction,
      progressActiveDaysBackfillFunction: progressActiveDaysBackfillResult.backfillFunction,
      globalMetricsVisible,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
      webBucket: web.bucket,
      webDistribution: web.distribution,
      webCustomDomain: web.customDomain,
      adminBucket: admin.bucket,
      adminDistribution: admin.distribution,
      adminCustomDomain: admin.customDomain,
      apexRedirectDistribution: web.apexRedirectDistribution,
      apexRedirectCustomDomain: web.apexRedirectCustomDomain,
      dbAccessInstance: analyticsAccessResult?.dbAccessInstance,
      reportingDbSecret: dbResult.reportingDbSecret,
      analyticsSshUsername: analyticsAccessResult?.sshUsername,
    });
  }
}
