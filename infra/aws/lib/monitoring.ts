import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
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
} from "./global-metrics";
import { communityLeaderboardSnapshotScheduleHours } from "./community-leaderboard";
import { streakLeaderboardSnapshotScheduleHours } from "./streak-leaderboard";
import { progressActiveDaysBackfillScheduleHours } from "./progress-active-days-backfill";

const communityLeaderboardSnapshotStaleEvaluationPeriods = 2;
const streakLeaderboardSnapshotStaleEvaluationPeriods = 2;
const progressActiveDaysBackfillStaleEvaluationPeriods = 2;

export interface MonitoringProps {
  alertEmail: string;
  db: rds.DatabaseInstance;
  restApi: apigw.RestApi;
  authRestApi: apigw.RestApi;
  mcpRestApi: apigw.RestApi;
  backendFn: lambda.IFunction;
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
}

export interface MonitoringResult {
  alertTopic: sns.Topic;
}

const authApiAccessLog5xxMetricNamespace: string = "FlashcardsOpenSourceApp/Auth";
const authApiAccessLog5xxMetricName: string = "AuthApiAccessLog5xx";
const authApiAccessLog5xxStatuses: ReadonlyArray<string> = ["500", "501", "502", "503", "504"];

function createAuthApiAccessLog5xxFilterPattern(): logs.IFilterPattern {
  return logs.FilterPattern.any(
    ...authApiAccessLog5xxStatuses.map((status: string) => logs.FilterPattern.stringValue("$.status", "=", status)),
  );
}

export function monitoring(scope: Construct, props: MonitoringProps): MonitoringResult {
  const alertTopic = new sns.Topic(scope, "AlertTopic", {
    topicName: "flashcards-open-source-app-alerts",
  });
  alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmail));

  new cloudwatch.Alarm(scope, "DbConnectionsAlarm", {
    metric: props.db.metricDatabaseConnections({
      period: cdk.Duration.minutes(5),
      statistic: "Average",
    }),
    threshold: 68,
    evaluationPeriods: 2,
    alarmDescription: "RDS connections above 80% capacity",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "DbStorageAlarm", {
    metric: props.db.metricFreeStorageSpace({
      period: cdk.Duration.minutes(15),
      statistic: "Average",
    }),
    threshold: 2 * 1024 * 1024 * 1024,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 1,
    alarmDescription: "RDS free storage below 2 GB",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "ApiGateway5xxAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "AuthApiGateway5xxAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "McpApiGateway5xxAlarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "5XXError",
      dimensionsMap: { ApiName: props.mcpRestApi.restApiName },
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 1,
    alarmDescription: "MCP API Gateway returned 3+ server errors in 5 minutes",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  const authApiAccessLog5xxMetricFilter = new logs.MetricFilter(scope, "AuthApiAccessLog5xxMetricFilter", {
    logGroup: props.authApiAccessLogGroup,
    filterPattern: createAuthApiAccessLog5xxFilterPattern(),
    metricNamespace: authApiAccessLog5xxMetricNamespace,
    metricName: authApiAccessLog5xxMetricName,
    metricValue: "1",
    defaultValue: 0,
  });

  new cloudwatch.Alarm(scope, "AuthApiAccessLog5xxAlarm", {
    metric: authApiAccessLog5xxMetricFilter.metric({
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Auth API access logs include a 5xx response",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "BackendLambdaErrorAlarm", {
    metric: props.backendFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Backend Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "AuthLambdaErrorAlarm", {
    metric: props.authFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Auth Lambda had unhandled errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "McpLambdaErrorAlarm", {
    metric: props.mcpFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "MCP Lambda had unhandled errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "CustomEmailSenderLambdaErrorAlarm", {
    metric: props.customEmailSenderFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Custom email sender Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "ChatWorkerLambdaErrorAlarm", {
    metric: props.chatWorkerFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Chat worker Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "ChatLiveLambdaErrorAlarm", {
    metric: props.chatLiveFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 3,
    evaluationPeriods: 1,
    alarmDescription: "Chat live SSE Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "GlobalMetricsSnapshotLambdaErrorAlarm", {
    metric: props.globalMetricsSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Global metrics snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "GlobalMetricsSnapshotFreshnessAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.communityLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Community leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  // The leaderboard snapshot lives in Postgres, refreshed by this hourly Lambda. A run
  // that does not happen leaves the snapshot stale, so a missing hourly invocation for two
  // consecutive hours (missing data treated as breaching) raises the staleness alarm. Run
  // failures are caught by the error alarm above because failed runs still count as
  // invocations.
  new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotStaleAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.streakLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Streak leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotStaleAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillLambdaErrorAlarm", {
    metric: props.progressActiveDaysBackfillFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Progress active review days backfill Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillStaleAlarm", {
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
  }).addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

  return { alertTopic };
}
