import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import {
  globalMetricsSnapshotFreshnessCheckIntervalHours,
  globalMetricsSnapshotFreshnessMaxAgeHours,
  globalMetricsSnapshotFreshnessMetricName,
  globalMetricsSnapshotFreshnessMetricNamespace,
  globalMetricsSnapshotFreshnessMetricStackDimensionName,
} from "./scheduled-jobs/global-metrics";
import type { AlternateHeartbeatHosts } from "./scheduled-jobs/public-endpoint-heartbeat";
import {
  createPublicEndpointHeartbeatTargets,
  publicEndpointHeartbeatIntervalMinutes,
  publicEndpointHeartbeatMetricHostDimensionName,
  publicEndpointHeartbeatMetricName,
  publicEndpointHeartbeatMetricNamespace,
} from "./scheduled-jobs/public-endpoint-heartbeat";
import { communityLeaderboardSnapshotScheduleHours } from "./scheduled-jobs/community-leaderboard";
import { streakLeaderboardSnapshotScheduleHours } from "./scheduled-jobs/streak-leaderboard";
import { progressActiveDaysBackfillScheduleHours } from "./scheduled-jobs/progress-active-days-backfill";
import { webGuestReaperScheduleHours } from "./scheduled-jobs/web-guest-reaper";
import { countryRetentionScheduleHours } from "./scheduled-jobs/country-retention";
import { dailyVisitorHashSaltExpiryScheduleHours } from "./scheduled-jobs/daily-visitor-hash-salt-expiry";
import { geoLiteCountryObjectExpirationDays } from "./geolite-country";
import { syntheticActorDetectorScheduleHours } from "./scheduled-jobs/synthetic-actor-detector";
import { addProductAnalyticsMonitoring } from "./product-analytics-monitoring";

const restApiNoTrafficEvaluationPeriods = 4;
const publicEndpointHeartbeatEvaluationPeriods = 3;
const publicEndpointHeartbeatDatapointsToAlarm = 2;
const certificateExpiryAlarmThresholdDays = 45;
const communityLeaderboardSnapshotStaleEvaluationPeriods = 2;
const streakLeaderboardSnapshotStaleEvaluationPeriods = 2;
const progressActiveDaysBackfillStaleEvaluationPeriods = 2;
const webGuestReaperStaleEvaluationPeriods = 2;

export interface MonitoringProps {
  alertTopic: sns.Topic;
  sourceStackName: string;
  db: rds.DatabaseInstance;
  restApi: apigw.RestApi;
  authRestApi: apigw.RestApi;
  mcpHttpApi: apigwv2.HttpApi;
  backendFn: lambda.IFunction;
  backendLogGroup: logs.ILogGroup;
  directImageIngestionFn: lambda.IFunction;
  directImageIngestionLogGroup: logs.ILogGroup;
  authFn: lambda.IFunction;
  mcpFn: lambda.IFunction;
  authApiAccessLogGroup: logs.ILogGroup;
  customEmailSenderFn: lambda.IFunction;
  chatWorkerFn: lambda.IFunction;
  chatLiveFn: lambda.IFunction;
  globalMetricsSnapshotFn: lambda.IFunction;
  communityLeaderboardSnapshotFn: lambda.IFunction;
  streakLeaderboardSnapshotFn: lambda.IFunction;
  progressActiveDaysBackfillFn: lambda.IFunction;
  webGuestReaperFn: lambda.IFunction;
  webGuestReaperLogGroup: logs.ILogGroup;
  countryRetentionFn: lambda.IFunction;
  dailyVisitorHashSaltExpiryFn: lambda.IFunction;
  syntheticActorDetectorFn: lambda.IFunction;
  generatedMediaPromotionFn: lambda.IFunction;
  multipartCompletionReconciliationFn: lambda.IFunction;
  multipartCompletionReconciliationLogGroup: logs.ILogGroup;
  catalogDumpFn: lambda.IFunction;
  baseDomain: string;
  apiCertificateArn: string | undefined;
  authCertificateArn: string | undefined;
  mcpCertificateArn: string | undefined;
  // The stack's second public hosts, already resolved (./alternate-host.ts) and
  // each undefined unless it is actually deployed. A certificate expires whether
  // or not its host is policed for liveness, so the expiry alarms read these.
  apiAlternateHost: string | undefined;
  apiAlternateCertificateArn: string | undefined;
  authAlternateHost: string | undefined;
  authAlternateCertificateArn: string | undefined;
  mcpAlternateHost: string | undefined;
  mcpAlternateCertificateArn: string | undefined;
  // The same hosts, but each undefined until it is declared live. The heartbeat
  // alarms below must cover exactly the targets the heartbeat itself probes.
  alternateHeartbeatHosts: AlternateHeartbeatHosts;
}

const authApiAccessLog5xxMetricNamespace: string = "FlashcardsOpenSourceApp/Auth";
const authApiAccessLog5xxMetricName: string = "AuthApiAccessLog5xx";
const authApiAccessLog5xxStatuses: ReadonlyArray<string> = ["500", "501", "502", "503", "504"];
const directImageIngestionHandled5xxMetricNamespace: string =
  "FlashcardsOpenSourceApp/DirectImageIngestion";
const directImageIngestionHandled5xxMetricName: string =
  "DirectImageIngestionHandledHttp5xx";
const directImageIngestionHandled5xxAction: string =
  "direct_image_ingestion_handled_http_5xx";
const multipartCompletionReconciliationFailureMetricNamespace: string =
  "FlashcardsOpenSourceApp/MultipartCompletionReconciliation";
const multipartCompletionReconciliationFailureMetricName: string =
  "FailedJobs";
export const multipartCompletionReconciliationFailureMetricValue: string =
  "1";
const webGuestReaperSaturationMetricNamespace: string =
  "FlashcardsOpenSourceApp/WebGuestReaper";
const webGuestReaperSaturationMetricName: string =
  "SaturatedRuns";
const webGuestReaperSaturationMetricValue: string =
  "1";
const geoLiteCountryMetricNamespace: string = "FlashcardsOpenSourceApp/GeoLiteCountry";
const geoLiteCountryLookupFailureMetricName: string = "LookupFailures";
const geoLiteCountryDatabasePublishedAgeMetricName: string = "DatabasePublishedAgeHours";
// Every route that records a lookup that threw, on one metric, because the cause and the runbook
// are the same unusable database: the consent route (apps/backend/src/routes/analyticsVisitor.ts)
// and the credential-free collector (apps/backend/src/routes/anonymousAnalytics.ts), which refuses
// the event rather than storing a null country. Deliberately not a count of unresolved addresses:
// apps/backend/src/geolocation/country.ts returns null for an address the database has no country
// for - a private range, an unallocated block - and throws only when the database itself is
// unusable, so ordinary traffic cannot reach this metric at all.
const geoLiteCountryLookupFailureActions: ReadonlyArray<string> = [
  "analytics_visitor_country_lookup_failed",
  "anonymous_analytics_country_lookup_failed",
];
const geoLiteCountryDatabaseLoadedAction: string = "geolite_country_database_loaded";
// Fifteen minutes is long enough for the three retries inside one download
// (apps/backend/src/geolocation/storage.ts) to have played out, and the two consecutive periods
// below are what separate a storage blip from a database that is not coming back.
const geoLiteCountryLookupFailurePeriodMinutes = 15;
const geoLiteCountryLookupFailureEvaluationPeriods = 2;
// Equal to `databaseRefreshIntervalMs` in apps/backend/src/geolocation/country.ts, which is not
// aligned to clock-hour boundaries: a container that loaded mid-period serves warm lookups for the
// rest of its TTL and contributes nothing to the period it spills into. A traffic-serving container
// therefore guarantees a datapoint only across two consecutive periods, which is why the alarm
// below ignores missing data rather than reading it as a verdict.
const geoLiteCountryDatabaseAgePeriodHours = 1;
// Four missed daily refreshes, measured from the S3 write rather than the MaxMind build date. Both
// walls of the usable band are close. Above: `geoLiteCountryObjectExpirationDays` in
// ./geolite-country.ts deletes the object seven days after that write, and a deleted object emits
// no age datapoint at all, so a threshold anywhere near 168 hours can never be reached. Below: the
// refresh workflow uploads unconditionally every day at 05:17 UTC
// (.github/workflows/geolite-country-refresh.yml) and a container can load just before the next
// run, so a healthy pipeline reports up to 24 hours and a threshold near that fires on a working
// system. Four days sits clear of both and leaves three days of lead time.
const geoLiteCountryDatabasePublishedAgeThresholdHours = 4 * 24;

function createAuthApiAccessLog5xxFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.any(
    ...authApiAccessLog5xxStatuses.map((status: string) => logs.FilterPattern.stringValue("$.status", "=", status)),
  );
}

export function createDirectImageIngestionHandled5xxFilterPattern():
logs.IFilterPattern {
  return logs.FilterPattern.all(
    logs.FilterPattern.stringValue(
      "$.message.action",
      "=",
      directImageIngestionHandled5xxAction,
    ),
    logs.FilterPattern.numberValue("$.message.statusCode", ">=", 500),
    logs.FilterPattern.numberValue("$.message.statusCode", "<", 600),
  );
}

export function createMultipartCompletionReconciliationFailureFilterPattern():
logs.IFilterPattern {
  return logs.FilterPattern.all(
    logs.FilterPattern.stringValue(
      "$.message.action",
      "=",
      "multipart_completion_reconciliation_job_terminally_failed",
    ),
  );
}

export function createWebGuestReaperSaturationFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.all(
    logs.FilterPattern.stringValue(
      "$.message.action",
      "=",
      "web_guest_reaper_completed",
    ),
    logs.FilterPattern.booleanValue("$.message.finished", false),
  );
}

export function createGeoLiteCountryLookupFailureFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.any(
    ...geoLiteCountryLookupFailureActions.map((action: string) => logs.FilterPattern.stringValue(
      "$.message.action",
      "=",
      action,
    )),
  );
}

export function createGeoLiteCountryDatabaseLoadedFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.stringValue(
    "$.message.action",
    "=",
    geoLiteCountryDatabaseLoadedAction,
  );
}

// CloudWatch notifies only on state transitions, so an alarm without an OK action sends alert
// mail that no recovery mail ever follows and the operator cannot tell a healed alarm from an
// ongoing outage without opening the console. Every alarm in this stack routes both transitions
// to the same alert topic.
function notifyAlertTopic(alarm: cloudwatch.Alarm, alertTopic: sns.Topic): void {
  const alertAction = new cloudwatchActions.SnsAction(alertTopic);
  alarm.addAlarmAction(alertAction);
  alarm.addOkAction(alertAction);
}

interface CertificateExpiryAlarmProps {
  alertTopic: sns.Topic;
  alarmId: string;
  certificateArn: string;
  host: string;
}

// ACM publishes DaysToExpiry about once a day, so a daily period with a single evaluated
// datapoint is the earliest this metric can be read at all, and the number only falls by one
// per day, so waiting for more datapoints would just delay the page. Managed renewal starts
// around 60 days before expiry, so a certificate still below the threshold has been failing to
// renew for weeks (usually a missing DNS validation record) while leaving that many days to fix
// it before the host goes down. Missing datapoints keep the current alarm state: the metric only
// stops for a certificate that no longer exists, which ACM does not allow while an API Gateway
// custom domain still uses it, and treating those as breaching would page on ACM publication
// jitter and on planned certificate replacements while treating them as OK would clear a real
// breach.
function createCertificateExpiryAlarm(scope: Construct, props: CertificateExpiryAlarmProps): void {
  notifyAlertTopic(new cloudwatch.Alarm(scope, props.alarmId, {
    metric: new cloudwatch.Metric({
      namespace: "AWS/CertificateManager",
      metricName: "DaysToExpiry",
      dimensionsMap: { CertificateArn: props.certificateArn },
      period: cdk.Duration.days(1),
      statistic: "Minimum",
    }),
    threshold: certificateExpiryAlarmThresholdDays,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    alarmDescription:
      `TLS certificate for ${props.host} expires in fewer than ` +
      `${certificateExpiryAlarmThresholdDays} days, so ACM auto-renewal has not completed`,
    treatMissingData: cloudwatch.TreatMissingData.MISSING,
  }), props.alertTopic);
}

export function monitoring(scope: Construct, props: MonitoringProps): void {
  const alertTopic = props.alertTopic;

  // Connection saturation here is a burst: a spike lasts about a minute, so a 5-minute average
  // is dominated by the idle minutes around it and two consecutive breaching periods never
  // happen. DatabaseConnections has one-minute granularity, so the maximum of a single minute is
  // the sharpest reading available. The API Lambda fleet is budgeted well below 70, and
  // migrations, scheduled jobs, the reporting role, and admin sessions sit on top of it, so a
  // minute above 70 means something outside the budget is holding connections while still
  // leaving headroom under the instance ceiling.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "DbConnectionsAlarm", {
    metric: props.db.metricDatabaseConnections({
      period: cdk.Duration.minutes(1),
      statistic: "Maximum",
    }),
    threshold: 70,
    evaluationPeriods: 1,
    alarmDescription:
      "RDS open connections peaked above 70 within one minute, above the connection budget of " +
      "the API Lambda fleet plus its known extra consumers, so connection exhaustion is close",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DbStorageAlarm", {
    metric: props.db.metricFreeStorageSpace({
      period: cdk.Duration.minutes(15),
      statistic: "Average",
    }),
    threshold: 2 * 1024 * 1024 * 1024,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 1,
    alarmDescription: "RDS free storage below 2 GB",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ApiGateway5xxAlarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "5XXError",
      dimensionsMap: { ApiName: props.restApi.restApiName },
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 5,
    evaluationPeriods: 1,
    alarmDescription: "API Gateway returned 5+ server errors in 5 minutes",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // Every other API alarm needs traffic to observe a failure, so a dead edge (expired TLS
  // certificate, broken DNS, detached custom domain) stays silent because API Gateway then
  // publishes no datapoints at all. Missing data is treated as breaching here on purpose,
  // and a full hour of zero requests keeps quiet organic traffic hours below the threshold.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "ApiGatewayNoTrafficAlarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "Count",
      dimensionsMap: { ApiName: props.restApi.restApiName },
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: restApiNoTrafficEvaluationPeriods,
    datapointsToAlarm: restApiNoTrafficEvaluationPeriods,
    alarmDescription:
      "API Gateway received no requests for one hour, so the public API edge is unreachable " +
      "(expired TLS certificate, broken DNS, or detached custom domain)",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  // Both auth 5xx alarms need two consecutive periods. A saturated authHandlerReservedConcurrency
  // reservation surfaces as an API Gateway 500 whose integrationStatus is 429, which
  // infra/aws/lib/gateways/api-gateway.ts documents as the intended bounded rejection protecting the
  // Postgres connection budget, so a crawler burst contained in one five-minute period is that bound
  // working rather than an incident. Auth failure that outlasts a burst still pages here, and an
  // auth host that stops serving pages through the public-endpoint heartbeat alarm on
  // auth.<baseDomain> within fifteen minutes.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "AuthApiGateway5xxAlarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "5XXError",
      dimensionsMap: { ApiName: props.authRestApi.restApiName },
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription:
      "Auth API Gateway returned 3+ server errors in each of two consecutive 5-minute periods",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "McpApiGateway5xxAlarm", {
    metric: props.mcpHttpApi.metricServerError({
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 1,
    alarmDescription: "MCP API Gateway returned 3+ server errors in 5 minutes",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  if (props.apiCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "ApiCertificateExpiryAlarm",
      certificateArn: props.apiCertificateArn,
      host: `api.${props.baseDomain}`,
    });
  }

  if (props.authCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "AuthCertificateExpiryAlarm",
      certificateArn: props.authCertificateArn,
      host: `auth.${props.baseDomain}`,
    });
  }

  if (props.mcpCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "McpCertificateExpiryAlarm",
      certificateArn: props.mcpCertificateArn,
      host: `mcp.${props.baseDomain}`,
    });
  }

  // Every alternate host carries its own certificate, so each needs its own
  // expiry alarm. Each exists only when the gateway also creates that domain.
  if (props.apiAlternateHost && props.apiAlternateCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "ApiAlternateCertificateExpiryAlarm",
      certificateArn: props.apiAlternateCertificateArn,
      host: props.apiAlternateHost,
    });
  }

  if (props.authAlternateHost && props.authAlternateCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "AuthAlternateCertificateExpiryAlarm",
      certificateArn: props.authAlternateCertificateArn,
      host: props.authAlternateHost,
    });
  }

  if (props.mcpAlternateHost && props.mcpAlternateCertificateArn) {
    createCertificateExpiryAlarm(scope, {
      alertTopic,
      alarmId: "McpAlternateCertificateExpiryAlarm",
      certificateArn: props.mcpAlternateCertificateArn,
      host: props.mcpAlternateHost,
    });
  }

  // The heartbeat publishes one datapoint per host every five minutes from outside AWS, so this
  // is the only alarm that can see a host that stopped serving entirely: a broken Cloudflare
  // CNAME, a detached API Gateway custom domain or a TLS failure produces no requests at all,
  // which every request-driven alarm reads as silence. Two breaching datapoints out of three
  // five-minute periods absorb a single transient blip or one skipped run while a genuine outage
  // pages after two consecutive failures, inside fifteen minutes. Missing data breaches on
  // purpose, unlike the certificate alarms above: a heartbeat that is not running leaves the
  // hosts unwatched, and that silence is exactly what this alarm exists to report.
  for (const target of createPublicEndpointHeartbeatTargets(props.baseDomain, props.alternateHeartbeatHosts)) {
    notifyAlertTopic(new cloudwatch.Alarm(scope, `${target.id}PublicEndpointHeartbeatAlarm`, {
      metric: new cloudwatch.Metric({
        namespace: publicEndpointHeartbeatMetricNamespace,
        metricName: publicEndpointHeartbeatMetricName,
        dimensionsMap: { [publicEndpointHeartbeatMetricHostDimensionName]: target.host },
        period: cdk.Duration.minutes(publicEndpointHeartbeatIntervalMinutes),
        statistic: "Minimum",
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: publicEndpointHeartbeatEvaluationPeriods,
      datapointsToAlarm: publicEndpointHeartbeatDatapointsToAlarm,
      alarmDescription:
        `Public host ${target.host} did not answer ${target.probeUrl} with HTTP 200 for two ` +
        "external heartbeat probes, or the heartbeat itself stopped reporting",
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }), alertTopic);
  }

  const authApiAccessLog5xxMetricFilter = new logs.MetricFilter(scope, "AuthApiAccessLog5xxMetricFilter", {
    logGroup: props.authApiAccessLogGroup,
    filterPattern: createAuthApiAccessLog5xxFilterPattern(),
    metricNamespace: authApiAccessLog5xxMetricNamespace,
    metricName: authApiAccessLog5xxMetricName,
    metricValue: "1",
    defaultValue: 0,
  });

  notifyAlertTopic(new cloudwatch.Alarm(scope, "AuthApiAccessLog5xxAlarm", {
    metric: authApiAccessLog5xxMetricFilter.metric({
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription:
      "Auth API access logs include a 5xx response in each of two consecutive 5-minute periods",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "BackendLambdaErrorAlarm", {
    metric: props.backendFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Backend Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DirectImageIngestionLambdaErrorAlarm", {
    metric: props.directImageIngestionFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Direct image ingestion Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  const directImageIngestionHandled5xxMetricFilter = new logs.MetricFilter(
    scope,
    "DirectImageIngestionHandled5xxMetricFilter",
    {
      logGroup: props.directImageIngestionLogGroup,
      filterPattern: createDirectImageIngestionHandled5xxFilterPattern(),
      metricNamespace: directImageIngestionHandled5xxMetricNamespace,
      metricName: directImageIngestionHandled5xxMetricName,
      metricValue: "1",
      defaultValue: 0,
    },
  );

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DirectImageIngestionHandled5xxAlarm", {
    metric: directImageIngestionHandled5xxMetricFilter.metric({
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription:
      "Direct image ingestion returned a handled HTTP 5xx response",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  addProductAnalyticsMonitoring(scope, {
    restApi: props.restApi,
    backendLogGroup: props.backendLogGroup,
    notifyAlert: (alarm: cloudwatch.Alarm): void => notifyAlertTopic(alarm, alertTopic),
  });

  notifyAlertTopic(new cloudwatch.Alarm(scope, "AuthLambdaErrorAlarm", {
    metric: props.authFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Auth Lambda had unhandled errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "McpLambdaErrorAlarm", {
    metric: props.mcpFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "MCP Lambda had unhandled errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "CustomEmailSenderLambdaErrorAlarm", {
    metric: props.customEmailSenderFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Custom email sender Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ChatWorkerLambdaErrorAlarm", {
    metric: props.chatWorkerFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Chat worker Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ChatLiveLambdaErrorAlarm", {
    metric: props.chatLiveFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 1,
    alarmDescription: "Chat live SSE Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ChatLiveLambdaThrottleAlarm", {
    metric: props.chatLiveFn.metricThrottles({
      period: cdk.Duration.minutes(1),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Chat live SSE Lambda had a pre-handler throttle",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "GlobalMetricsSnapshotLambdaErrorAlarm", {
    metric: props.globalMetricsSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Global metrics snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // The catalog dump has no schedule, so only failures of an actual run can alarm here.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "CatalogDumpLambdaErrorAlarm", {
    metric: props.catalogDumpFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Public catalog dump Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "GlobalMetricsSnapshotFreshnessAlarm", {
    metric: new cloudwatch.Metric({
      namespace: globalMetricsSnapshotFreshnessMetricNamespace,
      metricName: globalMetricsSnapshotFreshnessMetricName,
      dimensionsMap: {
        [globalMetricsSnapshotFreshnessMetricStackDimensionName]: props.sourceStackName,
      },
      period: cdk.Duration.hours(globalMetricsSnapshotFreshnessCheckIntervalHours),
      statistic: "Maximum",
    }),
    threshold: globalMetricsSnapshotFreshnessMaxAgeHours,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription:
      `Global metrics snapshot S3 object is older than ${globalMetricsSnapshotFreshnessMaxAgeHours} hours ` +
      "for two consecutive hourly checks or the freshness checker is not reporting",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.communityLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Community leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // The leaderboard snapshot lives in Postgres, refreshed by this hourly Lambda. A run
  // that does not happen leaves the snapshot stale, so a missing hourly invocation for two
  // consecutive hours (missing data treated as breaching) raises the staleness alarm. Run
  // failures are caught by the error alarm above because failed runs still count as
  // invocations.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotStaleAlarm", {
    metric: props.communityLeaderboardSnapshotFn.metricInvocations({
      period: cdk.Duration.hours(communityLeaderboardSnapshotScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: communityLeaderboardSnapshotStaleEvaluationPeriods,
    datapointsToAlarm: communityLeaderboardSnapshotStaleEvaluationPeriods,
    alarmDescription:
      "Community leaderboard snapshot Lambda has not run for two consecutive hours, " +
      "so the stored leaderboard snapshot is going stale",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.streakLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Streak leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotStaleAlarm", {
    metric: props.streakLeaderboardSnapshotFn.metricInvocations({
      period: cdk.Duration.hours(streakLeaderboardSnapshotScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: streakLeaderboardSnapshotStaleEvaluationPeriods,
    datapointsToAlarm: streakLeaderboardSnapshotStaleEvaluationPeriods,
    alarmDescription:
      "Streak leaderboard snapshot Lambda has not run for two consecutive days, " +
      "so the stored streak leaderboard snapshot is going stale",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillLambdaErrorAlarm", {
    metric: props.progressActiveDaysBackfillFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Progress active review days backfill Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillStaleAlarm", {
    metric: props.progressActiveDaysBackfillFn.metricInvocations({
      period: cdk.Duration.hours(progressActiveDaysBackfillScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: progressActiveDaysBackfillStaleEvaluationPeriods,
    datapointsToAlarm: progressActiveDaysBackfillStaleEvaluationPeriods,
    alarmDescription:
      "Progress active review days backfill Lambda has not run for two consecutive hours, " +
      "so known-timezone users may keep missing active-day materialization",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  // The reaper permanently deletes org.user_settings and org.workspaces rows once a day, so a run
  // that throws every night has to reach the alert topic rather than only Sentry. A candidate scan
  // that errors, on the reporting role's 30s statement_timeout or on anything else, ends that run
  // where it stopped and does the same every night for as long as the cause persists, and the
  // entrypoint rethrows so it surfaces here as an errored invocation. WebGuestReaperSaturatedAlarm
  // below fires on such a run too, because it completes with finished: false, but it describes
  // guests being minted faster than the schedule reaps them, which a failed scan is not; this alarm
  // is the one that names it. The staleness alarm below cannot stand in for it either: Lambda
  // counts an errored invocation in Invocations like any other, so the run count stays at one per
  // day and a job that fails every night never looks stale.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "WebGuestReaperLambdaErrorAlarm", {
    metric: props.webGuestReaperFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Web guest reaper Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // A schedule that quietly stops firing emits nothing at all, which no error metric can show.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "WebGuestReaperStaleAlarm", {
    metric: props.webGuestReaperFn.metricInvocations({
      period: cdk.Duration.hours(webGuestReaperScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: webGuestReaperStaleEvaluationPeriods,
    datapointsToAlarm: webGuestReaperStaleEvaluationPeriods,
    alarmDescription:
      "Web guest reaper Lambda has not run for two consecutive days, " +
      "so never-converted web guest identities are accumulating again",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  // A run that stops on maxPages or on its deadline with candidates still waiting is a successful
  // invocation with no errors, so neither alarm above sees it while web guest rows keep
  // accumulating - the exact failure this job exists to prevent. The run reports that state as
  // finished: false on its one completion record, and this is what watches it. One saturated run is
  // enough to alarm: it means that day's candidates were not all reaped. Raising the entrypoint's
  // batchSize or maxPages only helps a run that still stops on its page limit; once a real backlog
  // exists the run is deadline-bound instead, because 500 x 5 per-guest transactions of about six
  // round trips each do not fit the reaper Lambda's five-minute timeout, and raising either knob
  // then changes nothing. The remaining levers are that Lambda's timeout and memorySize in
  // lib/scheduled-jobs/web-guest-reaper.ts.
  const webGuestReaperSaturationMetricFilter = new logs.MetricFilter(
    scope,
    "WebGuestReaperSaturationMetricFilter",
    {
      logGroup: props.webGuestReaperLogGroup,
      filterPattern: createWebGuestReaperSaturationFilterPattern(),
      metricNamespace: webGuestReaperSaturationMetricNamespace,
      metricName: webGuestReaperSaturationMetricName,
      metricValue: webGuestReaperSaturationMetricValue,
      defaultValue: 0,
    },
  );
  notifyAlertTopic(new cloudwatch.Alarm(scope, "WebGuestReaperSaturatedAlarm", {
    metric: webGuestReaperSaturationMetricFilter.metric({
      period: cdk.Duration.hours(webGuestReaperScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription:
      "Web guest reaper finished a run with candidates still waiting, " +
      "so never-converted web guest identities are being minted faster than the schedule reaps them",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "CountryRetentionLambdaErrorAlarm", {
    metric: props.countryRetentionFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Country retention failed or left expired periods behind; inspect capacity and database contention",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "CountryRetentionStaleAlarm", {
    metric: props.countryRetentionFn.metricInvocations({ period: cdk.Duration.hours(countryRetentionScheduleHours), statistic: "Sum" }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Country retention has not run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DailyVisitorHashSaltExpiryLambdaErrorAlarm", {
    metric: props.dailyVisitorHashSaltExpiryFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Daily visitor hash salt expiry failed, so an ended day's salt may still be stored",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DailyVisitorHashSaltExpiryStaleAlarm", {
    metric: props.dailyVisitorHashSaltExpiryFn.metricInvocations({
      period: cdk.Duration.hours(dailyVisitorHashSaltExpiryScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Daily visitor hash salt expiry has not run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "SyntheticActorDetectorLambdaErrorAlarm", {
    metric: props.syntheticActorDetectorFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Synthetic actor detector failed; analytics exclusions are not being recorded",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "SyntheticActorDetectorStaleAlarm", {
    metric: props.syntheticActorDetectorFn.metricInvocations({ period: cdk.Duration.hours(syntheticActorDetectorScheduleHours), statistic: "Sum" }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Synthetic actor detector has not run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "GeneratedMediaPromotionLambdaErrorAlarm", {
    metric: props.generatedMediaPromotionFn.metricErrors(
      { period: cdk.Duration.minutes(5), statistic: "Sum" },
    ),
    threshold: 1, evaluationPeriods: 1, alarmDescription: "Generated-media promotion Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(scope, "GeneratedMediaPromotionStaleAlarm", {
    metric: props.generatedMediaPromotionFn.metricInvocations(
      { period: cdk.Duration.minutes(5), statistic: "Sum" },
    ),
    threshold: 1, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2, datapointsToAlarm: 2,
    alarmDescription: "Generated-media promotion Lambda has not run for ten minutes",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(
    scope,
    "MultipartCompletionReconciliationLambdaErrorAlarm",
    {
      metric: props.multipartCompletionReconciliationFn.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription:
        "Multipart completion reconciliation Lambda had unhandled errors",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    },
  ), alertTopic);

  notifyAlertTopic(new cloudwatch.Alarm(
    scope,
    "MultipartCompletionReconciliationStaleAlarm",
    {
      metric: props.multipartCompletionReconciliationFn.metricInvocations({
        period: cdk.Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      alarmDescription:
        "Multipart completion reconciliation Lambda has not run for ten minutes",
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    },
  ), alertTopic);

  const multipartCompletionReconciliationFailureMetricFilter =
    new logs.MetricFilter(
      scope,
      "MultipartCompletionReconciliationFailureMetricFilter",
      {
        logGroup: props.multipartCompletionReconciliationLogGroup,
        filterPattern:
          createMultipartCompletionReconciliationFailureFilterPattern(),
        metricNamespace:
          multipartCompletionReconciliationFailureMetricNamespace,
        metricName: multipartCompletionReconciliationFailureMetricName,
        metricValue: multipartCompletionReconciliationFailureMetricValue,
        defaultValue: 0,
      },
    );
  notifyAlertTopic(new cloudwatch.Alarm(
    scope,
    "MultipartCompletionReconciliationFailedJobsAlarm",
    {
      metric: multipartCompletionReconciliationFailureMetricFilter.metric({
        period: cdk.Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription:
        "Multipart completion reconciliation terminally failed one or more jobs",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    },
  ), alertTopic);

  // Two alarms on one dependency, because its two ways of breaking have nothing in common.
  //
  // What both protect: `isConsentRequiredForRequest` (apps/backend/src/routes/analyticsVisitor.ts)
  // treats a country it cannot determine as consent-required, so on that route a GeoLite database
  // that stops working does not even error - it silently shows the consent banner to every visitor
  // on earth rather than to the EEA and the UK, and analytics coverage collapses everywhere.
  // Neither condition appears in Lambda Errors. The hard failure does also raise the API Gateway
  // 5XX alarm, because the credential-free collector refuses its events rather than storing a null
  // country, but these two alarms are the only ones that name the cause. Both filters read the
  // backend API Lambda's core-owned log group.

  // Hard failure: the object is gone or unreadable, the environment is unconfigured, the database
  // is the wrong type, or it has already crossed the 30-day cliff. All of them throw out of the
  // lookup and land here, on every request, until someone fixes them.
  const geoLiteCountryLookupFailureMetricFilter = new logs.MetricFilter(
    scope,
    "GeoLiteCountryLookupFailureMetricFilter",
    {
      logGroup: props.backendLogGroup,
      filterPattern: createGeoLiteCountryLookupFailureFilterPattern(),
      metricNamespace: geoLiteCountryMetricNamespace,
      metricName: geoLiteCountryLookupFailureMetricName,
      metricValue: "1",
      defaultValue: 0,
    },
  );
  // The threshold is one failure, not a rate: ordinary traffic cannot produce this record at all,
  // so a single occurrence already means the database is unusable and a count tuned to traffic
  // would only delay the page. The guard against paging on a transient S3 incident is the two
  // consecutive periods instead, which a single failed download cannot span.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "GeoLiteCountryLookupFailureAlarm", {
    metric: geoLiteCountryLookupFailureMetricFilter.metric({
      period: cdk.Duration.minutes(geoLiteCountryLookupFailurePeriodMinutes),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: geoLiteCountryLookupFailureEvaluationPeriods,
    datapointsToAlarm: geoLiteCountryLookupFailureEvaluationPeriods,
    alarmDescription:
      "GeoLite country lookup threw in each of " +
      `${geoLiteCountryLookupFailureEvaluationPeriods} consecutive ` +
      `${geoLiteCountryLookupFailurePeriodMinutes}-minute periods, so the database is missing, ` +
      "unreadable, the wrong type, or past its 30-day limit: every visitor worldwide is being " +
      "treated as consent-required and every credential-free analytics event that carries a " +
      "country is being refused with a 500 rather than stored without one, while the events " +
      "exempt from carrying one (docs/anonymous-client-analytics.md) keep landing with a 200. " +
      "An address the database simply has no country for returns null and never reaches this " +
      "metric. Check the private GeoLite bucket " +
      "and the last GeoLite Country Refresh run; docs/geolite-country.md has the runbook",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // Ageing out: nothing is failing yet. The daily refresh has stopped landing a new object, and the
  // object still being served is walking toward the lifecycle expiry that deletes it and converts
  // this into the failure above, all at once, for everybody. No `defaultValue` here, unlike the
  // failure filter: this is a gauge, and publishing a zero for a period in which no container
  // loaded the object would report a stale database as brand new.
  const geoLiteCountryDatabaseAgeMetricFilter = new logs.MetricFilter(
    scope,
    "GeoLiteCountryDatabaseAgeMetricFilter",
    {
      logGroup: props.backendLogGroup,
      filterPattern: createGeoLiteCountryDatabaseLoadedFilterPattern(),
      metricNamespace: geoLiteCountryMetricNamespace,
      metricName: geoLiteCountryDatabasePublishedAgeMetricName,
      metricValue: "$.message.publishedAgeHours",
    },
  );
  // Maximum, not Average: containers hold independent copies and the question is whether any
  // request is still being answered from an old one. That is also why the alarm keeps firing for up
  // to an hour after a fresh object is published - those containers really are still serving the
  // old object - and why the OK mail this topic sends is the signal that the fix has landed
  // everywhere. Missing data is ignored rather than treated as not breaching, for the same reason:
  // a gauge only reports when a container loads, so a silent period is absence of evidence. Reading
  // it as healthy would mail a recovery notice at the worst possible moment, because the loudest
  // silence of all is the object being deleted, when every load throws and the failure alarm above
  // is the thing that should be speaking.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "GeoLiteCountryDatabaseStaleAlarm", {
    metric: geoLiteCountryDatabaseAgeMetricFilter.metric({
      period: cdk.Duration.hours(geoLiteCountryDatabaseAgePeriodHours),
      statistic: "Maximum",
    }),
    threshold: geoLiteCountryDatabasePublishedAgeThresholdHours,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    alarmDescription:
      "The GeoLite Country object being served was uploaded at least " +
      `${geoLiteCountryDatabasePublishedAgeThresholdHours / 24} days ago, so the daily GeoLite ` +
      "Country Refresh workflow has stopped publishing. Nothing is failing yet: the private " +
      `bucket's ${geoLiteCountryObjectExpirationDays}-day lifecycle expiry deletes the object in ` +
      `about ${geoLiteCountryObjectExpirationDays - geoLiteCountryDatabasePublishedAgeThresholdHours / 24} ` +
      "days, and from then every country lookup throws and the consent banner is shown worldwide. " +
      "docs/geolite-country.md has the runbook",
    treatMissingData: cloudwatch.TreatMissingData.IGNORE,
  }), alertTopic);
}
