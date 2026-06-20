import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  progressActiveDaysBackfillScheduleExpression,
  progressActiveDaysBackfillScheduleHours,
} from "./progress-active-days-backfill";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("progress active days backfill is scheduled hourly", () => {
  assert.equal(progressActiveDaysBackfillScheduleHours, 1);
  assert.equal(progressActiveDaysBackfillScheduleExpression, "cron(15 * * * ? *)");
});

test("progress active days backfill construct creates the hourly schedule and Lambda", () => {
  const source = readLibSource("lib/progress-active-days-backfill.ts");

  assert.match(source, /new lambdaNodejs\.NodejsFunction\(scope, "ProgressActiveDaysBackfillHandler"/);
  assert.match(
    source,
    /entry: resolveFromRepoRoot\("apps", "backend", "src", "entrypoints", "lambda-progress-active-days-backfill\.ts"\)/,
  );
  assert.match(source, /DB_SECRET_ARN: props\.backendDbSecret\.secretArn/);
  assert.match(source, /REPORTING_DB_SECRET_ARN: props\.reportingDbSecret\.secretArn/);
  assert.match(source, /props\.backendDbSecret\.grantRead\(backfillFunction\)/);
  assert.match(source, /props\.reportingDbSecret\.grantRead\(backfillFunction\)/);
  assert.match(source, /new scheduler\.CfnSchedule\(scope, "ProgressActiveDaysBackfillHourlySchedule"/);
  assert.match(source, /scheduleExpression: progressActiveDaysBackfillScheduleExpression/);
  assert.match(source, /new iam\.Role\(scope, "ProgressActiveDaysBackfillSchedulerRole"/);
  assert.match(source, /actions: \["lambda:InvokeFunction"\]/);
});

test("stack wires the progress active days backfill function into monitoring, ci-cd, and outputs", () => {
  const source = readLibSource("lib/stack.ts");

  assert.match(source, /const progressActiveDaysBackfillResult = progressActiveDaysBackfill\(this, \{/);
  assert.match(source, /backendDbSecret: dbResult\.backendDbSecret,/);
  assert.match(source, /reportingDbSecret: dbResult\.reportingDbSecret,/);
  assert.match(source, /progressActiveDaysBackfillFn: progressActiveDaysBackfillResult\.backfillFunction,/);
  assert.match(source, /progressActiveDaysBackfillFunction: progressActiveDaysBackfillResult\.backfillFunction,/);
});

test("monitoring alarms cover progress active days backfill errors and staleness", () => {
  const source = readLibSource("lib/monitoring.ts");

  assert.match(source, /new cloudwatch\.Alarm\(scope, "ProgressActiveDaysBackfillLambdaErrorAlarm"/);
  assert.match(source, /props\.progressActiveDaysBackfillFn\.metricErrors\(/);
  assert.match(source, /new cloudwatch\.Alarm\(scope, "ProgressActiveDaysBackfillStaleAlarm"/);
  assert.match(source, /props\.progressActiveDaysBackfillFn\.metricInvocations\(/);
  assert.match(source, /comparisonOperator: cloudwatch\.ComparisonOperator\.LESS_THAN_THRESHOLD/);
  assert.match(source, /treatMissingData: cloudwatch\.TreatMissingData\.BREACHING/);
});

test("ci-cd grants the release workflow permission to invoke the progress active days backfill Lambda", () => {
  const source = readLibSource("lib/ci-cd.ts");

  assert.match(source, /sid: "InvokeProgressActiveDaysBackfillLambda"/);
  assert.match(source, /resources: \[props\.progressActiveDaysBackfillFn\.functionArn\]/);
});
