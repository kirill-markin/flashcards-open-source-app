import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { networking } from "./networking";
import { database } from "./database";
import { preSignUp } from "./pre-signup";
import { auth } from "./auth";
import { apiGateway } from "./api-gateway";
import { monitoring } from "./monitoring";
import { ciCd } from "./ci-cd";
import { backupPlan } from "./backup";
import { outputs } from "./outputs";
import { webApp } from "./web";
import { adminApp } from "./admin";
import { migrationRunner } from "./migration-runner";
import { authGateway } from "./auth-gateway";
import { analyticsAccess, type AnalyticsAccessResult } from "./analytics-access";
import { globalMetrics } from "./global-metrics";

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
    const webCertificateArnUsEast1 = getOptionalContextValue(this, "webCertificateArnUsEast1");
    const adminCertificateArnUsEast1 = getOptionalContextValue(this, "adminCertificateArnUsEast1");
    const apexRedirectCertificateArnUsEast1 = getOptionalContextValue(this, "apexRedirectCertificateArnUsEast1");
    const githubOidcProviderArn = getOptionalContextValue(this, "githubOidcProviderArn");
    const openAiApiKeySecretArn = getOptionalContextValue(this, "openAiApiKeySecretArn");
    const langfusePublicKeySecretArn = getOptionalContextValue(this, "langfusePublicKeySecretArn");
    const langfuseSecretKeySecretArn = getOptionalContextValue(this, "langfuseSecretKeySecretArn");
    const langfuseBaseUrl = getOptionalContextValue(this, "langfuseBaseUrl");
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
    const migrationFn = migrationRunner(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      dbOwnerSecret: dbResult.dbOwnerSecret,
      backendDbSecret: dbResult.backendDbSecret,
      authDbSecret: dbResult.authDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      adminEmails,
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
      backendFn: api.backendFn,
      authFn: authApi.authFn,
      authApiAccessLogGroup: authApi.accessLogGroup,
      customEmailSenderFn: authResult.customEmailSenderFn,
      chatWorkerFn: api.chatWorkerFn,
      chatLiveFn: api.chatLiveFn,
      globalMetricsSnapshotFn: globalMetricsResult.snapshotFunction,
    });

    ciCd(this, {
      stackId: this.stackId,
      githubRepo,
      githubOidcProviderArn,
      authFn: authApi.authFn,
      demoPasswordSecretArn,
      globalMetricsSnapshotFn: globalMetricsResult.snapshotFunction,
      globalMetricsSnapshotFreshnessCheckerFn: globalMetricsResult.snapshotFreshnessCheckerFunction,
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
      backendFn: api.backendFn,
      chatWorkerFn: api.chatWorkerFn,
      chatLiveFn: api.chatLiveFn,
      authFn: authApi.authFn,
      migrationFn,
      globalMetricsSnapshotFunction: globalMetricsResult.snapshotFunction,
      globalMetricsSnapshotFreshnessCheckerFunction: globalMetricsResult.snapshotFreshnessCheckerFunction,
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
