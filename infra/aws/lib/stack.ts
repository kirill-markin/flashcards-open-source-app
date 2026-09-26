import * as cdk from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { networking } from "./networking";
import { database } from "./database";
import { preSignUp } from "./pre-signup";
import { auth } from "./auth";
import { apiGateway } from "./gateways/api-gateway";
import { monitoring, type MonitoringProps } from "./monitoring";
import { ciCd } from "./ci-cd";
import { backupPlan } from "./backup";
import { outputs } from "./outputs";
import { getPrimaryWebHost, resolveWebPrimaryHostRedirectTarget, webApp } from "./web";
import { adminApp, getPrimaryAdminHost } from "./admin";
import { resolveDistributionHosts } from "./cloudfront-additional-host";
import {
  addDatabaseMigrationDependency,
  databaseMigrationGate,
  migrationRunner,
} from "./migration-runner";
import { authGateway } from "./gateways/auth-gateway";
import { mcpGateway } from "./gateways/mcp-gateway";
import { isMcpAlternateHostLive, mcpAlternateHostConfig } from "./mcp-alternate-host";
import { isAlternateHostLive, resolveAlternateHosts } from "./alternate-host";
import { analyticsAccess, type AnalyticsAccessResult } from "./analytics-access";
import { globalMetrics } from "./scheduled-jobs/global-metrics";
import { communityLeaderboard } from "./scheduled-jobs/community-leaderboard";
import { streakLeaderboard } from "./scheduled-jobs/streak-leaderboard";
import { progressActiveDaysBackfill } from "./scheduled-jobs/progress-active-days-backfill";
import { countryRetention } from "./scheduled-jobs/country-retention";
import { dailyVisitorHashSaltExpiry } from "./scheduled-jobs/daily-visitor-hash-salt-expiry";
import { syntheticActorDetector } from "./scheduled-jobs/synthetic-actor-detector";
import { webGuestReaper } from "./scheduled-jobs/web-guest-reaper";
import type { AlternateHeartbeatHosts } from "./scheduled-jobs/public-endpoint-heartbeat";
import { publicEndpointHeartbeat } from "./scheduled-jobs/public-endpoint-heartbeat";
import {
  generatedMediaPromotion,
  type GeneratedMediaPromotionScheduleState,
} from "./scheduled-jobs/generated-media-promotion";
import {
  multipartCompletionReconciliation,
  type MultipartCompletionReconciliationScheduleState,
} from "./scheduled-jobs/multipart-completion-reconciliation";
import { mediaAssets } from "./media-assets";
import { catalogDump } from "./catalog-dump";
import { geoLiteCountry } from "./geolite-country";
import { parsePublicOrigin } from "./public-origin";
import { resolvePublishedApiOrigin } from "./published-api-origin";

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

function getScheduledJobState(
  stack: cdk.Stack,
  contextKey: string,
): "DISABLED" | "ENABLED" {
  const value = getOptionalContextValue(stack, contextKey);
  if (value === undefined) {
    return "DISABLED";
  }
  if (value === "DISABLED" || value === "ENABLED") {
    return value;
  }
  throw new Error(
    `${contextKey} must be DISABLED or ENABLED`,
  );
}

// Defaults to enabled on purpose. The bastion is the only operator path into
// the private database, so an unset or absent value must never remove it; only
// an explicit "false" does.
function getAnalyticsAccessEnabled(stack: cdk.Stack): boolean {
  const value = stack.node.tryGetContext("analyticsAccessEnabled");
  if (value === undefined || value === "") return true;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("analyticsAccessEnabled must be true or false");
}

function getMediaBlobCleanupEnabled(stack: cdk.Stack): boolean {
  const value = stack.node.tryGetContext("mediaBlobCleanupEnabled");
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("mediaBlobCleanupEnabled must be true or false");
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

export class FlashcardsOpenSourceAppStack extends cdk.Stack {
  readonly monitoringInputs: MonitoringProps;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseDomain = this.node.tryGetContext("domainName") as string;
    const alertEmail = this.node.tryGetContext("alertEmail") as string;
    const githubRepo = this.node.tryGetContext("githubRepo") as string;
    const apiCertificateArn = getOptionalContextValue(this, "apiCertificateArn");
    const authCertificateArn = getOptionalContextValue(this, "authCertificateArn");
    // Optional second public host for the REST API and for the auth API, each on
    // the same stage as its primary host. Both values of a pair are required;
    // with either missing that gateway is unchanged. The primary hosts are
    // derived from domainName and are never replaced by these.
    const apiAlternateDomainName = getOptionalContextValue(this, "apiAlternateDomainName");
    const apiAlternateCertificateArn = getOptionalContextValue(this, "apiAlternateCertificateArn");
    const authAlternateDomainName = getOptionalContextValue(this, "authAlternateDomainName");
    const authAlternateCertificateArn = getOptionalContextValue(this, "authAlternateCertificateArn");
    // The browser cookie domain is settable on its own so it can move to another
    // domain without touching domainName, which every host name derives from.
    // Unset means domainName, exactly as before it was settable.
    const cookieDomain = getOptionalContextValue(this, "cookieDomain");
    const mcpCertificateArn = getOptionalContextValue(this, "mcpCertificateArn");
    // Optional second public MCP host served by the same API, for example a
    // rebranded domain. Both values are required for it to be created; with
    // either missing the deploy is unchanged.
    const mcpAlternateDomainName = getOptionalContextValue(this, "mcpAlternateDomainName");
    const mcpAlternateCertificateArn = getOptionalContextValue(this, "mcpAlternateCertificateArn");
    // The one place every alternate host of this stack is resolved, so each
    // name is checked against the whole set rather than only against its own
    // primary host. Each entry is undefined unless both of its context values
    // are set. What comes out is the one host string every consumer of that
    // host agrees on: the API Gateway custom domain, the host a handler
    // accepts, the resource the authorization server mints tokens for, and the
    // heartbeat metric dimension.
    const alternateHosts = resolveAlternateHosts({
      api: {
        hostRole: "API",
        primaryHost: `api.${baseDomain}`,
        contextVariableName: "CDK_API_ALTERNATE_DOMAIN_NAME",
        alternateDomainName: apiAlternateDomainName,
        alternateCertificateArn: apiAlternateCertificateArn,
      },
      auth: {
        hostRole: "auth",
        primaryHost: `auth.${baseDomain}`,
        contextVariableName: "CDK_AUTH_ALTERNATE_DOMAIN_NAME",
        alternateDomainName: authAlternateDomainName,
        alternateCertificateArn: authAlternateCertificateArn,
      },
      mcp: mcpAlternateHostConfig(baseDomain, mcpAlternateDomainName, mcpAlternateCertificateArn),
    });
    const mcpAlternateHost = alternateHosts.mcp;
    // Policing that host is a separate, later switch. Its Cloudflare CNAME can
    // only be created from the McpAlternateCustomDomainTarget output that the
    // deploy above produces, so the deploy that creates the host would fail its
    // own smoke and page on its own heartbeat if it also started watching. Flip
    // this once the record exists; nothing else reads it.
    const mcpAlternateHeartbeatHost = isMcpAlternateHostLive(
      getOptionalContextValue(this, "mcpAlternateHostLive"),
    )
      ? mcpAlternateHost
      : undefined;
    // The second API and auth hosts wait for the same kind of switch, for the
    // same reason: their CNAMEs can only be created from the
    // ApiAlternateCustomDomainTarget and AuthAlternateCustomDomainTarget
    // outputs of the deploy that creates the custom domains, so that deploy
    // would page on its own heartbeat if it also started probing them.
    const alternateHeartbeatHosts: AlternateHeartbeatHosts = {
      api: isAlternateHostLive(getOptionalContextValue(this, "apiAlternateHostLive"))
        ? alternateHosts.api
        : undefined,
      auth: isAlternateHostLive(getOptionalContextValue(this, "authAlternateHostLive"))
        ? alternateHosts.auth
        : undefined,
      mcp: mcpAlternateHeartbeatHost,
    };
    const webCertificateArnUsEast1 = getOptionalContextValue(this, "webCertificateArnUsEast1");
    const adminCertificateArnUsEast1 = getOptionalContextValue(this, "adminCertificateArnUsEast1");
    // Optional second public host for the web and admin distributions, for
    // example a rebranded domain served next to the original one. Both values of
    // a pair are required; the certificate replaces the distribution's single
    // viewer certificate and must cover both of its hosts.
    const webAdditionalDomainName = getOptionalContextValue(this, "webAdditionalDomainName");
    const webAdditionalCertificateArnUsEast1 = getOptionalContextValue(this, "webAdditionalCertificateArnUsEast1");
    const adminAdditionalDomainName = getOptionalContextValue(this, "adminAdditionalDomainName");
    const adminAdditionalCertificateArnUsEast1 = getOptionalContextValue(this, "adminAdditionalCertificateArnUsEast1");
    const apexRedirectCertificateArnUsEast1 = getOptionalContextValue(this, "apexRedirectCertificateArnUsEast1");
    const githubOidcProviderArn = getOptionalContextValue(this, "githubOidcProviderArn");
    const openAiApiKeySecretArn = getOptionalContextValue(this, "openAiApiKeySecretArn");
    const langfusePublicKeySecretArn = getOptionalContextValue(this, "langfusePublicKeySecretArn");
    const langfuseSecretKeySecretArn = getOptionalContextValue(this, "langfuseSecretKeySecretArn");
    const langfuseBaseUrl = getOptionalContextValue(this, "langfuseBaseUrl");
    // Optional per-deploy override for the public marketing-site origin used by
    // the discovery legal links and MCP implementation metadata. Defaults inside
    // each gateway to `https://<baseDomain>` when unset, so prod works without
    // setting the GitHub var.
    const configuredSiteBaseUrl = getOptionalRawContextValue(this, "siteBaseUrl");
    const siteBaseUrl = configuredSiteBaseUrl === undefined
      ? undefined
      : parsePublicOrigin(configuredSiteBaseUrl, "siteBaseUrl");
    // Optional per-deploy override for the public API origin the backend, auth,
    // MCP and catalog-dump Lambdas advertise. Defaults to `https://api.<baseDomain>`
    // when unset, so an unconfigured deploy is unchanged. It moves only published
    // addresses; see docs/published-api-origin.md for why the auth origin
    // deliberately has no companion override.
    // Throws at synth unless it names a host this stack serves and polices
    // (./published-api-origin.ts).
    const configuredApiBaseUrl = getOptionalRawContextValue(this, "apiBaseUrl");
    const apiBaseUrl = resolvePublishedApiOrigin({
      baseDomain,
      configuredApiBaseUrl: configuredApiBaseUrl === undefined
        ? undefined
        : parsePublicOrigin(configuredApiBaseUrl, "apiBaseUrl"),
      apiAlternateDomainName,
      apiAlternateHost: alternateHosts.api,
      apiAlternateHostLive: isAlternateHostLive(getOptionalContextValue(this, "apiAlternateHostLive")),
    });
    const sentryContext = validateBackendSentryContext({
      sentryDsnSecretArn: getOptionalContextValue(this, "sentryDsnSecretArn"),
      sentryEnvironment: getOptionalContextValue(this, "sentryEnvironment"),
      sentryRelease: getOptionalContextValue(this, "sentryRelease"),
      sentryTracesSampleRate: getOptionalContextValue(this, "sentryTracesSampleRate"),
    });
    const demoEmailDostip = getOptionalContextValue(this, "demoEmailDostip");
    const demoPasswordSecretArn = getOptionalContextValue(this, "demoPasswordSecretArn");
    const adminEmails = getOptionalContextValue(this, "adminEmails");
    const resendApiKeySecretArn = getOptionalContextValue(this, "resendApiKeySecretArn");
    const resendSenderEmail = getOptionalContextValue(this, "resendSenderEmail");
    // When enabled, global stats are visible externally through the public snapshot endpoint.
    // When disabled, no client can fetch global stats from that endpoint.
    const rawGlobalMetricsVisible = getOptionalRawContextValue(this, "globalMetricsVisible");
    const globalMetricsVisible = rawGlobalMetricsVisible === "true";
    const generatedMediaPromotionScheduleState:
      GeneratedMediaPromotionScheduleState = getScheduledJobState(
        this,
        "generatedMediaPromotionScheduleState",
      );
    const mediaBlobCleanupEnabled = getMediaBlobCleanupEnabled(this);
    const multipartCompletionReconciliationScheduleState:
      MultipartCompletionReconciliationScheduleState = getScheduledJobState(
        this,
        "multipartCompletionReconciliationScheduleState",
      );
    const analyticsAccessEnabled = getAnalyticsAccessEnabled(this);

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
    const webGuestReaperResult = webGuestReaper(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      ...sentryContext,
    });
    const countryRetentionResult = countryRetention(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      ...sentryContext,
    });
    const dailyVisitorHashSaltExpiryResult = dailyVisitorHashSaltExpiry(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      ...sentryContext,
    });
    const syntheticActorDetectorResult = syntheticActorDetector(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      ...sentryContext,
    });
    publicEndpointHeartbeat(this, { baseDomain, alternateHeartbeatHosts });
    // Both distributions are resolved here, before either is constructed and
    // before the media bucket, auth and API stages that have to allow their
    // hosts as browser origins, because an additional host must be checked
    // against every alias the stack claims and not only against its own
    // distribution's primary. A repeat passes synth and fails the deploy with
    // CNAMEAlreadyExists.
    const webPrimaryHost = getPrimaryWebHost(baseDomain);
    const adminPrimaryHost = getPrimaryAdminHost(baseDomain);
    const claimedCloudFrontHosts = [
      webPrimaryHost,
      adminPrimaryHost,
      // The apex redirect distribution only exists with its own certificate.
      ...(apexRedirectCertificateArnUsEast1 === undefined ? [] : [baseDomain]),
    ];
    const webHosts = resolveDistributionHosts(
      webPrimaryHost,
      webCertificateArnUsEast1,
      webAdditionalDomainName,
      webAdditionalCertificateArnUsEast1,
      claimedCloudFrontHosts,
    );
    const adminHosts = resolveDistributionHosts(
      adminPrimaryHost,
      adminCertificateArnUsEast1,
      adminAdditionalDomainName,
      adminAdditionalCertificateArnUsEast1,
      [...claimedCloudFrontHosts, ...(webHosts.domainNames ?? [])],
    );
    const mediaAssetsResult = mediaAssets(this, {
      baseDomain,
      // The web bundle talks to this bucket directly, so its second host needs
      // the same CORS entry the API and auth allowlists already give it.
      webAdditionalHost: webHosts.additionalCustomDomain,
    });
    const generatedMediaPromotionResult = generatedMediaPromotion(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      mediaAssetsBucket: mediaAssetsResult.bucket,
      mediaBlobCleanupEnabled,
      scheduleState: generatedMediaPromotionScheduleState,
      ...sentryContext,
    });
    const multipartCompletionReconciliationResult =
      multipartCompletionReconciliation(this, {
        vpc: net.vpc,
        lambdaSg: net.lambdaSg,
        db: dbResult.db,
        backendDbSecret: dbResult.backendDbSecret,
        mediaAssetsBucket: mediaAssetsResult.bucket,
        scheduleState: multipartCompletionReconciliationScheduleState,
        ...sentryContext,
      });
    // `app.<baseDomain>` stops serving the bundle and redirects to the additional
    // web host instead; undefined until that switch is on. See
    // ./web.ts for why the same switch moves the public app origin below.
    const webPrimaryHostRedirectTarget = resolveWebPrimaryHostRedirectTarget(
      getOptionalContextValue(this, "webPrimaryHostRetired"),
      webHosts,
    );
    // The one place this stack decides where backend-generated links send people:
    // invites, the published catalog dump's install links, and the card link an
    // agent is handed by the card_authoring guide and by the in-app chat system
    // prompt. Every consumer takes this value rather than deriving its own, so
    // they cannot disagree about which host is the app. Share links are built by
    // the clients.
    const publicAppOrigin = parsePublicOrigin(
      `https://${webPrimaryHostRedirectTarget ?? webPrimaryHost}`,
      "appBaseUrl",
    );

    const catalogDumpResult = catalogDump(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      mediaAssetsBucket: mediaAssetsResult.bucket,
      baseDomain,
      publicAppOrigin,
      apiBaseUrl,
      ...sentryContext,
    });
    let analyticsAccessResult: AnalyticsAccessResult | undefined;
    if (analyticsAccessEnabled) {
      analyticsAccessResult = analyticsAccess(this, {
        vpc: net.vpc,
        dbSg: net.dbSg,
      });
    }
    const preSignUpFn = preSignUp(this, { ...sentryContext });
    const authResult = auth(this, {
      preSignUpFn,
      resendApiKeySecretArn,
      resendSenderEmail,
      ...sentryContext,
    });
    const authApi = authGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      authDbSecret: dbResult.authDbSecret,
      baseDomain,
      apiBaseUrl,
      authCertificateArn,
      authAlternateHost: alternateHosts.auth,
      authAlternateCertificateArn,
      apiAlternateHost: alternateHosts.api,
      cookieDomain,
      mcpAlternateHost,
      // Second hosts for the browser bundles. Auth allows them as redirect
      // targets and browser origins; without that a bundle served from one of
      // them cannot sign in, and no client rebuild can fix it.
      webAdditionalHost: webHosts.additionalCustomDomain,
      adminAdditionalHost: adminHosts.additionalCustomDomain,
      demoEmailDostip,
      demoPasswordSecretArn,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
      ...sentryContext,
    });
    const mcpApi = mcpGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      baseDomain,
      siteBaseUrl,
      publicAppOrigin,
      apiBaseUrl,
      mcpCertificateArn,
      mcpAlternateDomainName,
      mcpAlternateCertificateArn,
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
    const migrationGate = databaseMigrationGate(this, migrationFn);
    const api = apiGateway(this, {
      vpc: net.vpc,
      lambdaSg: net.lambdaSg,
      db: dbResult.db,
      backendDbSecret: dbResult.backendDbSecret,
      reportingDbSecret: dbResult.reportingDbSecret,
      baseDomain,
      siteBaseUrl,
      apiBaseUrl,
      apiCertificateArn,
      apiAlternateHost: alternateHosts.api,
      apiAlternateCertificateArn,
      authAlternateHost: alternateHosts.auth,
      // Second hosts for the browser clients, owned by the CloudFront
      // distributions above. The API only needs their names, to allow them as
      // browser origins: a host that serves the bundle but is not an allowed
      // origin fails every preflight. Where links point is publicAppOrigin below.
      webAdditionalHost: webHosts.additionalCustomDomain,
      adminAdditionalHost: adminHosts.additionalCustomDomain,
      publicAppOrigin,
      cookieDomain,
      openAiApiKeySecretArn,
      langfusePublicKeySecretArn,
      langfuseSecretKeySecretArn,
      langfuseBaseUrl,
      ...sentryContext,
      resendApiKeySecretArn,
      resendSenderEmail,
      demoEmailDostip,
      globalMetricsVisible,
      globalMetricsSnapshotBucket: globalMetricsResult.snapshotBucket,
      globalMetricsSnapshotObjectKey: globalMetricsResult.snapshotObjectKey,
      mediaAssetsBucket: mediaAssetsResult.bucket,
      catalogDumpFunction: catalogDumpResult.dumpFunction,
      catalogDumpArtifact: {
        bucket: catalogDumpResult.bucket,
        cdnBaseUrl: catalogDumpResult.cdnBaseUrl,
      },
      userPoolId: authResult.userPool.userPoolId,
      userPoolArn: authResult.userPool.userPoolArn,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
    });
    const geoLiteCountryBucket = geoLiteCountry(this, api.backendFn);
    addDatabaseMigrationDependency(api.backendFn, migrationGate);
    addDatabaseMigrationDependency(api.directImageIngestionFn, migrationGate);
    // The auth Lambda reads and writes the product database too, so it must not be published ahead
    // of the migrations its statements need (db/migrations/0159_surrogate_user_identity.sql grants
    // it the auth.user_identities INSERT its account creation performs).
    addDatabaseMigrationDependency(authApi.authFn, migrationGate);
    addDatabaseMigrationDependency(webGuestReaperResult.reaperFunction, migrationGate);
    addDatabaseMigrationDependency(countryRetentionResult.retentionFunction, migrationGate);
    addDatabaseMigrationDependency(dailyVisitorHashSaltExpiryResult.expiryFunction, migrationGate);
    addDatabaseMigrationDependency(syntheticActorDetectorResult.detectorFunction, migrationGate);
    const web = webApp(this, {
      baseDomain,
      hosts: webHosts,
      apexRedirectCertificateArnUsEast1,
      primaryHostRedirectTarget: webPrimaryHostRedirectTarget,
    });
    const admin = adminApp(this, {
      baseDomain,
      hosts: adminHosts,
    });

    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "flashcards-open-source-app-alerts",
    });
    alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));

    // These core-owned retention resources create missing groups before metric filters run.
    // A name-only log-group import would lose that creation dependency.
    this.monitoringInputs = {
      alertTopic,
      sourceStackName: this.stackName,
      directImageIngestionLogGroup: api.directImageIngestionFn.logGroup,
      backendLogGroup: api.backendFn.logGroup,
      webGuestReaperLogGroup: webGuestReaperResult.reaperFunction.logGroup,
      multipartCompletionReconciliationLogGroup:
        multipartCompletionReconciliationResult.reconciliationFunction.logGroup,
      db: dbResult.db,
      restApi: api.restApi,
      authRestApi: authApi.restApi,
      mcpHttpApi: mcpApi.httpApi,
      backendFn: api.backendFn,
      directImageIngestionFn: api.directImageIngestionFn,
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
      countryRetentionFn: countryRetentionResult.retentionFunction,
      dailyVisitorHashSaltExpiryFn: dailyVisitorHashSaltExpiryResult.expiryFunction,
      syntheticActorDetectorFn: syntheticActorDetectorResult.detectorFunction,
      webGuestReaperFn: webGuestReaperResult.reaperFunction,
      generatedMediaPromotionFn: generatedMediaPromotionResult.promotionFunction,
      multipartCompletionReconciliationFn:
        multipartCompletionReconciliationResult.reconciliationFunction,
      catalogDumpFn: catalogDumpResult.dumpFunction,
      baseDomain,
      apiCertificateArn,
      authCertificateArn,
      mcpCertificateArn,
      apiAlternateHost: alternateHosts.api,
      apiAlternateCertificateArn,
      authAlternateHost: alternateHosts.auth,
      authAlternateCertificateArn,
      mcpAlternateHost,
      mcpAlternateCertificateArn,
      alternateHeartbeatHosts,
    };
    if (this.node.tryGetContext("monitoringTopology") !== "split") {
      monitoring(this, this.monitoringInputs);
    }

    ciCd(this, {
      stackId: this.stackId,
      geoLiteCountryBucket,
      githubRepo,
      githubOidcProviderArn,
      authFn: authApi.authFn,
      demoPasswordSecretArn,
      globalMetricsSnapshotFn: globalMetricsResult.snapshotFunction,
      globalMetricsSnapshotFreshnessCheckerFn: globalMetricsResult.snapshotFreshnessCheckerFunction,
      communityLeaderboardSnapshotFn: communityLeaderboardResult.snapshotFunction,
      streakLeaderboardSnapshotFn: streakLeaderboardResult.snapshotFunction,
      progressActiveDaysBackfillFn: progressActiveDaysBackfillResult.backfillFunction,
      webGuestReaperFn: webGuestReaperResult.reaperFunction,
      catalogDumpFn: catalogDumpResult.dumpFunction,
      migrationFn,
      generatedMediaPromotionScheduleArn:
        generatedMediaPromotionResult.promotionScheduleArn,
      multipartCompletionReconciliationScheduleArn:
        multipartCompletionReconciliationResult.reconciliationScheduleArn,
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
      alertTopic,
      restApi: api.restApi,
      authRestApi: authApi.restApi,
      mcpHttpApi: mcpApi.httpApi,
      mcpHttpStage: mcpApi.httpStage,
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
      webGuestReaperFunction: webGuestReaperResult.reaperFunction,
      catalogDumpBucket: catalogDumpResult.bucket,
      catalogDumpDistribution: catalogDumpResult.distribution,
      catalogDumpFunction: catalogDumpResult.dumpFunction,
      globalMetricsVisible,
      userPoolId: authResult.userPool.userPoolId,
      userPoolClientId: authResult.userPoolClient.userPoolClientId,
      webBucket: web.bucket,
      webDistribution: web.distribution,
      webCustomDomain: web.customDomain,
      webPrimaryHostRedirectTarget,
      adminBucket: admin.bucket,
      adminDistribution: admin.distribution,
      adminCustomDomain: admin.customDomain,
      apexRedirectDistribution: web.apexRedirectDistribution,
      apexRedirectCustomDomain: web.apexRedirectCustomDomain,
      mediaAssetsBucket: mediaAssetsResult.bucket,
      generatedMediaPromotionScheduleName:
        generatedMediaPromotionResult.promotionScheduleName,
      multipartCompletionReconciliationScheduleName:
        multipartCompletionReconciliationResult.reconciliationScheduleName,
      reportingDbSecret: dbResult.reportingDbSecret,
      analyticsSsmInstanceId: analyticsAccessResult?.ssmInstanceId,
    });
  }
}
