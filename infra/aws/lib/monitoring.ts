import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import {
  globalMetricsSnapshotFreshnessCheckIntervalHours,
  globalMetricsSnapshotFreshnessMaxAgeHours,
  globalMetricsSnapshotFreshnessMetricName,
  globalMetricsSnapshotFreshnessMetricNamespace,
  globalMetricsSnapshotFreshnessMetricStackDimensionName,
} from "./scheduled-jobs/global-metrics";
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

const restApiNoTrafficEvaluationPeriods = 4;
const publicEndpointHeartbeatEvaluationPeriods = 3;
const publicEndpointHeartbeatDatapointsToAlarm = 2;
const certificateExpiryAlarmThresholdDays = 45;
const communityLeaderboardSnapshotStaleEvaluationPeriods = 2;
const streakLeaderboardSnapshotStaleEvaluationPeriods = 2;
const progressActiveDaysBackfillStaleEvaluationPeriods = 2;

export interface MonitoringProps {
  alertEmail: string;
  db: rds.DatabaseInstance;
  restApi: apigw.RestApi;
  authRestApi: apigw.RestApi;
  mcpHttpApi: apigwv2.HttpApi;
  backendFn: lambda.IFunction;
  directImageIngestionFn: lambda.Function;
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
  generatedMediaPromotionFn: lambda.IFunction;
  multipartCompletionReconciliationFn: lambda.Function;
  catalogDumpFn: lambda.IFunction;
  baseDomain: string;
  apiCertificateArn: string | undefined;
  authCertificateArn: string | undefined;
  mcpCertificateArn: string | undefined;
}

export interface MonitoringResult {
  alertTopic: sns.Topic;
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
// The analytics ingest method is watched through the metrics API Gateway publishes for it, so
// nothing here depends on the shape of a log line. The resource path and the method must stay equal
// to the resource declared in infra/aws/lib/gateways/api-gateway.ts, whose stage method options keep
// metrics enabled for this method so the per-method dimensions are published at all.
const productAnalyticsIngestResourcePath: string = "/analytics/events";
const productAnalyticsIngestMethod: string = "POST";
const productAnalyticsAlarmPeriodMinutes = 5;
const productAnalyticsIngest5xxThreshold = 5;
// A saturated analytics pool answers 429 rather than 5xx, so this threshold is not a share of the
// route's traffic but the point at which batches are being refused systematically rather than one
// at a time. It is the only signal this route publishes for its own database capacity, and the
// per-method throttle is 20 rps, so anything tuned to the throttle instead would need a full outage
// at peak traffic before it fired.
const productAnalyticsIngestClientErrorThreshold = 25;
const productAnalyticsIngestClientErrorEvaluationPeriods = 2;
// Half of the 20 rps per-method throttle declared in infra/aws/lib/gateways/api-gateway.ts, summed
// over the alarm period. A batch carries up to 50 events, so this rate is already six figures of
// appended rows per period and is far above what product use explains at this stage.
const productAnalyticsIngestRequestVolumeThreshold = 3000;
const productAnalyticsIngestRequestVolumeEvaluationPeriods = 2;

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

// API Gateway publishes Count, 4XXError and 5XXError per method once the stage keeps metrics
// enabled for it, so the analytics ingest alarms read metrics the service emits on its own instead
// of anything derived from a log line.
function createProductAnalyticsIngestMetric(
  restApi: apigw.RestApi,
  metricName: string,
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: "AWS/ApiGateway",
    metricName,
    dimensionsMap: {
      ApiName: restApi.restApiName,
      Stage: restApi.deploymentStage.stageName,
      Resource: productAnalyticsIngestResourcePath,
      Method: productAnalyticsIngestMethod,
    },
    period: cdk.Duration.minutes(productAnalyticsAlarmPeriodMinutes),
    statistic: "Sum",
  });
}

export function monitoring(scope: Construct, props: MonitoringProps): MonitoringResult {
  const alertTopic = new sns.Topic(scope, "AlertTopic", {
    topicName: "flashcards-open-source-app-alerts",
  });
  alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmail));

  notifyAlertTopic(new cloudwatch.Alarm(scope, "DbConnectionsAlarm", {
    metric: props.db.metricDatabaseConnections({
      period: cdk.Duration.minutes(5),
      statistic: "Average",
    }),
    threshold: 68,
    evaluationPeriods: 2,
    alarmDescription: "RDS connections above 80% capacity",
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

  notifyAlertTopic(new cloudwatch.Alarm(scope, "AuthApiGateway5xxAlarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "5XXError",
      dimensionsMap: { ApiName: props.authRestApi.restApiName },
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 1,
    alarmDescription: "Auth API Gateway returned 3+ server errors in 5 minutes",
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

  // The heartbeat publishes one datapoint per host every five minutes from outside AWS, so this
  // is the only alarm that can see a host that stopped serving entirely: a broken Cloudflare
  // CNAME, a detached API Gateway custom domain or a TLS failure produces no requests at all,
  // which every request-driven alarm reads as silence. Two breaching datapoints out of three
  // five-minute periods absorb a single transient blip or one skipped run while a genuine outage
  // pages after two consecutive failures, inside fifteen minutes. Missing data breaches on
  // purpose, unlike the certificate alarms above: a heartbeat that is not running leaves the
  // hosts unwatched, and that silence is exactly what this alarm exists to report.
  for (const target of createPublicEndpointHeartbeatTargets(props.baseDomain)) {
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
    evaluationPeriods: 1,
    alarmDescription: "Auth API access logs include a 5xx response",
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
      logGroup: props.directImageIngestionFn.logGroup,
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

  // What reaches this metric is the database being unreachable, which the writer answers with 503,
  // and a defect. A saturated or slow-connecting database is refused with 429 by the analytics
  // writer instead and is watched by the client-error alarm below, so a low count here already means
  // something no retry from the client's queue is going to fix.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "ProductAnalyticsIngest5xxAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "5XXError"),
    threshold: productAnalyticsIngest5xxThreshold,
    evaluationPeriods: 1,
    alarmDescription:
      `Product analytics ingest answered ${productAnalyticsIngest5xxThreshold}+ requests with a 5xx in ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes, so the analytics database is unreachable for this route ` +
      "or the route itself is failing",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // A REST API publishes no throttle-only metric, so a throttled request is counted inside the
  // method's 4XXError along with the auth rejections. Everything that protects this route answers
  // 429 here: the per-method stage throttle, the analytics writer's pool cap, and a pool acquisition
  // that times out because the database is saturated or connecting slowly. That last one is why the
  // threshold is low: this is where a database-capacity incident on this route now surfaces, and the
  // 5xx alarm above no longer sees it. A contract violation answers 200 with per-event results and
  // never reaches this metric, so a sustained 4xx rate on this method means batches are being
  // refused rather than adjudicated. Two consecutive periods keep a client release rolling out
  // behind an expired token from paging on one spike, and a capacity incident is sustained.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "ProductAnalyticsIngestClientErrorAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "4XXError"),
    threshold: productAnalyticsIngestClientErrorThreshold,
    evaluationPeriods: productAnalyticsIngestClientErrorEvaluationPeriods,
    datapointsToAlarm: productAnalyticsIngestClientErrorEvaluationPeriods,
    alarmDescription:
      `Product analytics ingest refused ${productAnalyticsIngestClientErrorThreshold}+ requests with a 4xx per ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes for two consecutive periods, so the method throttle, the ` +
      "analytics writer pool, a database too saturated to hand out a connection, or client authentication is " +
      "rejecting whole batches",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

  // An accepted batch answers 200, so a broken client stuck in a redelivery loop or an abusive
  // caller touches neither 4XXError nor 5XXError and shows up only as append-only row growth and a
  // bill. This route ships no per-identity rate limiting by design, which makes this static
  // high-water mark the compensating control for that decision. Two consecutive periods keep a
  // queue flush after an outage, which is exactly the traffic the offline-first clients are built
  // to produce, from paging on a single period.
  notifyAlertTopic(new cloudwatch.Alarm(scope, "ProductAnalyticsIngestRequestVolumeAlarm", {
    metric: createProductAnalyticsIngestMetric(props.restApi, "Count"),
    threshold: productAnalyticsIngestRequestVolumeThreshold,
    evaluationPeriods: productAnalyticsIngestRequestVolumeEvaluationPeriods,
    datapointsToAlarm: productAnalyticsIngestRequestVolumeEvaluationPeriods,
    alarmDescription:
      `Product analytics ingest took ${productAnalyticsIngestRequestVolumeThreshold}+ requests per ` +
      `${productAnalyticsAlarmPeriodMinutes} minutes for two consecutive periods, so batches are arriving far ` +
      "faster than product use explains and analytics rows are growing unwatched",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }), alertTopic);

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
        [globalMetricsSnapshotFreshnessMetricStackDimensionName]: cdk.Stack.of(scope).stackName,
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
        logGroup: props.multipartCompletionReconciliationFn.logGroup,
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

  return { alertTopic };
}
