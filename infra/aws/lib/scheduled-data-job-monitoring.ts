import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { communityLeaderboardSnapshotScheduleHours } from "./scheduled-jobs/community-leaderboard";
import { streakLeaderboardSnapshotScheduleHours } from "./scheduled-jobs/streak-leaderboard";
import { progressActiveDaysBackfillScheduleHours } from "./scheduled-jobs/progress-active-days-backfill";
import { cardAdditionReconciliationScheduleHours } from "./scheduled-jobs/card-addition-reconciliation";
import { webGuestReaperScheduleHours } from "./scheduled-jobs/web-guest-reaper";
import { countryRetentionScheduleHours } from "./scheduled-jobs/country-retention";
import { dailyVisitorHashSaltExpiryScheduleHours } from "./scheduled-jobs/daily-visitor-hash-salt-expiry";
import { syntheticActorDetectorScheduleHours } from "./scheduled-jobs/synthetic-actor-detector";
import { probableAndroidBurstRefreshScheduleHours } from "./scheduled-jobs/probable-android-burst-refresh";

const communityLeaderboardSnapshotStaleEvaluationPeriods = 2;
const streakLeaderboardSnapshotStaleEvaluationPeriods = 2;
const progressActiveDaysBackfillStaleEvaluationPeriods = 2;
const webGuestReaperStaleEvaluationPeriods = 2;

const webGuestReaperSaturationMetricNamespace: string =
  "FlashcardsOpenSourceApp/WebGuestReaper";
const webGuestReaperSaturationMetricName: string =
  "SaturatedRuns";
const webGuestReaperSaturationMetricValue: string =
  "1";

export interface ScheduledDataJobMonitoringInputs {
  communityLeaderboardSnapshotFn: lambda.IFunction;
  streakLeaderboardSnapshotFn: lambda.IFunction;
  progressActiveDaysBackfillFn: lambda.IFunction;
  cardAdditionReconciliationFn: lambda.IFunction;
  cardAdditionReconciliationLogGroup: logs.ILogGroup;
  webGuestReaperFn: lambda.IFunction;
  webGuestReaperLogGroup: logs.ILogGroup;
  countryRetentionFn: lambda.IFunction;
  dailyVisitorHashSaltExpiryFn: lambda.IFunction;
  syntheticActorDetectorFn: lambda.IFunction;
  probableAndroidBurstRefreshFn: lambda.IFunction;
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

export function addScheduledDataJobMonitoring(
  scope: Construct,
  props: ScheduledDataJobMonitoringInputs,
  notifyAlert: (alarm: cloudwatch.Alarm) => void,
): void {
  notifyAlert(new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.communityLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Community leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  // The leaderboard snapshot lives in Postgres, refreshed by this hourly Lambda. A run
  // that does not happen leaves the snapshot stale, so a missing hourly invocation for two
  // consecutive hours (missing data treated as breaching) raises the staleness alarm. Run
  // failures are caught by the error alarm above because failed runs still count as
  // invocations.
  notifyAlert(new cloudwatch.Alarm(scope, "CommunityLeaderboardSnapshotStaleAlarm", {
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
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotLambdaErrorAlarm", {
    metric: props.streakLeaderboardSnapshotFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Streak leaderboard snapshot Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "StreakLeaderboardSnapshotStaleAlarm", {
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
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillLambdaErrorAlarm", {
    metric: props.progressActiveDaysBackfillFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Progress active review days backfill Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "ProgressActiveDaysBackfillStaleAlarm", {
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
  }));

  const cardAdditionReconciliationErrorAlarm = new cloudwatch.Alarm(scope, "CardAdditionReconciliationLambdaErrorAlarm", {
    metric: props.cardAdditionReconciliationFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Legacy card-addition reconciliation failed; inspect its structured failure and retry logs",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  notifyAlert(cardAdditionReconciliationErrorAlarm);

  const cardAdditionReconciliationCompletedMetricFilter = new logs.MetricFilter(scope, "CardAdditionReconciliationCompletedMetricFilter", {
    logGroup: props.cardAdditionReconciliationLogGroup,
    filterPattern: logs.FilterPattern.stringValue("$.message.action", "=", "card_addition_reconciliation_completed"),
    metricNamespace: "FlashcardsOpenSourceApp/CardAdditionReconciliation",
    metricName: "CompletedRuns",
    metricValue: "1",
    defaultValue: 0,
  });
  const cardAdditionReconciliationStaleAlarm = new cloudwatch.Alarm(scope, "CardAdditionReconciliationStaleAlarm", {
    metric: cardAdditionReconciliationCompletedMetricFilter.metric({
      period: cdk.Duration.hours(cardAdditionReconciliationScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Legacy card-addition reconciliation has not completed a run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  });
  notifyAlert(cardAdditionReconciliationStaleAlarm);

  const cardAdditionReconciliationBacklogMetricFilter = new logs.MetricFilter(scope, "CardAdditionReconciliationBacklogMetricFilter", {
    logGroup: props.cardAdditionReconciliationLogGroup,
    filterPattern: logs.FilterPattern.all(
      logs.FilterPattern.stringValue("$.message.action", "=", "card_addition_reconciliation_completed"),
      logs.FilterPattern.booleanValue("$.message.finished", false),
    ),
    metricNamespace: "FlashcardsOpenSourceApp/CardAdditionReconciliation",
    metricName: "UnfinishedRuns",
    metricValue: "1",
    defaultValue: 0,
  });
  const cardAdditionReconciliationBacklogAlarm = new cloudwatch.Alarm(scope, "CardAdditionReconciliationBacklogAlarm", {
    metric: cardAdditionReconciliationBacklogMetricFilter.metric({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Legacy card-addition reconciliation reached its batch limit with recoverable work remaining; run another bounded catch-up",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  notifyAlert(cardAdditionReconciliationBacklogAlarm);

  for (const [id, alarm] of [
    ["CardAdditionReconciliationErrorAlarmName", cardAdditionReconciliationErrorAlarm],
    ["CardAdditionReconciliationStaleAlarmName", cardAdditionReconciliationStaleAlarm],
    ["CardAdditionReconciliationBacklogAlarmName", cardAdditionReconciliationBacklogAlarm],
  ] as const) {
    new cdk.CfnOutput(scope, id, { value: alarm.alarmName });
  }

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
  notifyAlert(new cloudwatch.Alarm(scope, "WebGuestReaperLambdaErrorAlarm", {
    metric: props.webGuestReaperFn.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: "Sum",
    }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Web guest reaper Lambda had errors",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  // A schedule that quietly stops firing emits nothing at all, which no error metric can show.
  notifyAlert(new cloudwatch.Alarm(scope, "WebGuestReaperStaleAlarm", {
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
  }));

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
  notifyAlert(new cloudwatch.Alarm(scope, "WebGuestReaperSaturatedAlarm", {
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
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "CountryRetentionLambdaErrorAlarm", {
    metric: props.countryRetentionFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Country retention failed or left expired periods behind; inspect capacity and database contention",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "CountryRetentionStaleAlarm", {
    metric: props.countryRetentionFn.metricInvocations({ period: cdk.Duration.hours(countryRetentionScheduleHours), statistic: "Sum" }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Country retention has not run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "DailyVisitorHashSaltExpiryLambdaErrorAlarm", {
    metric: props.dailyVisitorHashSaltExpiryFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Daily visitor hash salt expiry failed, so an ended day's salt may still be stored",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "DailyVisitorHashSaltExpiryStaleAlarm", {
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
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "SyntheticActorDetectorLambdaErrorAlarm", {
    metric: props.syntheticActorDetectorFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Synthetic actor detector failed; analytics exclusions are not being recorded",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "SyntheticActorDetectorStaleAlarm", {
    metric: props.syntheticActorDetectorFn.metricInvocations({ period: cdk.Duration.hours(syntheticActorDetectorScheduleHours), statistic: "Sum" }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Synthetic actor detector has not run for two consecutive days",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "ProbableAndroidBurstRefreshLambdaErrorAlarm", {
    metric: props.probableAndroidBurstRefreshFn.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: "Probable Android burst or scraper-fleet refresh failed; analytics reports read a stale classification",
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }));

  notifyAlert(new cloudwatch.Alarm(scope, "ProbableAndroidBurstRefreshStaleAlarm", {
    metric: props.probableAndroidBurstRefreshFn.metricInvocations({
      period: cdk.Duration.hours(probableAndroidBurstRefreshScheduleHours),
      statistic: "Sum",
    }),
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    alarmDescription: "Probable Android burst refresh has not run for two consecutive hours",
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }));
}
