import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  webGuestReaperScheduleExpression,
  webGuestReaperScheduleHours,
} from "./web-guest-reaper";
import { createWebGuestReaperSaturationFilterPattern } from "../monitoring";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("web guest reaper is scheduled daily", () => {
  assert.equal(webGuestReaperScheduleHours, 24);
  assert.equal(webGuestReaperScheduleExpression, "cron(30 4 * * ? *)");
});

test("web guest reaper construct creates the daily schedule and Lambda", () => {
  const source = readLibSource("lib/scheduled-jobs/web-guest-reaper.ts");

  assert.match(source, /new lambdaNodejs\.NodejsFunction\(scope, "WebGuestReaperHandler"/);
  assert.match(
    source,
    /entry: resolveFromRepoRoot\("apps", "backend", "src", "entrypoints", "scheduledJobs", "lambda-web-guest-reaper\.ts"\)/,
  );
  assert.match(source, /DB_SECRET_ARN: props\.backendDbSecret\.secretArn/);
  assert.match(source, /REPORTING_DB_SECRET_ARN: props\.reportingDbSecret\.secretArn/);
  assert.match(source, /props\.backendDbSecret\.grantRead\(reaperFunction\)/);
  assert.match(source, /props\.reportingDbSecret\.grantRead\(reaperFunction\)/);
  assert.match(source, /new scheduler\.CfnSchedule\(scope, "WebGuestReaperDailySchedule"/);
  assert.match(source, /scheduleExpression: webGuestReaperScheduleExpression/);
  assert.match(source, /new iam\.Role\(scope, "WebGuestReaperSchedulerRole"/);
  assert.match(source, /actions: \["lambda:InvokeFunction"\]/);
});

// The entrypoint turns one failed candidate into a Lambda error and the job deletes production rows
// permanently, so it must never be replayed: the default retry behaviour would re-run a destructive
// job against the same poison candidate many times inside one day. Whether EventBridge Scheduler
// invokes a Lambda target asynchronously is not established here, and if it does, the schedule's
// retry policy alone leaves Lambda's own async retries in charge, so both are pinned.
test("web guest reaper pins both scheduler and Lambda async retries off", () => {
  const source = readLibSource("lib/scheduled-jobs/web-guest-reaper.ts");

  assert.match(source, /retryPolicy: \{ maximumRetryAttempts: 0 \}/);
  assert.match(source, /reaperFunction\.configureAsyncInvoke\(\{ retryAttempts: 0 \}\)/);
});

test("stack wires the web guest reaper function into monitoring, ci-cd, and outputs", () => {
  const source = readLibSource("lib/stack.ts");

  assert.match(source, /const webGuestReaperResult = webGuestReaper\(this, \{/);
  assert.match(source, /backendDbSecret: dbResult\.backendDbSecret,/);
  assert.match(source, /reportingDbSecret: dbResult\.reportingDbSecret,/);
  assert.match(source, /webGuestReaperFn: webGuestReaperResult\.reaperFunction,/);
  assert.match(source, /webGuestReaperFunction: webGuestReaperResult\.reaperFunction,/);
});

test("monitoring alarms cover web guest reaper errors and staleness", () => {
  const source = readLibSource("lib/monitoring.ts");

  assert.match(source, /new cloudwatch\.Alarm\(scope, "WebGuestReaperLambdaErrorAlarm"/);
  assert.match(source, /props\.webGuestReaperFn\.metricErrors\(/);
  assert.match(source, /new cloudwatch\.Alarm\(scope, "WebGuestReaperStaleAlarm"/);
  assert.match(source, /props\.webGuestReaperFn\.metricInvocations\(/);
  assert.match(source, /period: cdk\.Duration\.hours\(webGuestReaperScheduleHours\)/);
  assert.match(source, /comparisonOperator: cloudwatch\.ComparisonOperator\.LESS_THAN_THRESHOLD/);
  assert.match(source, /treatMissingData: cloudwatch\.TreatMissingData\.BREACHING/);
});

// A saturated run is a successful invocation with no errors, so neither alarm above sees it and the
// completion record's finished flag is the only signal that guests were left behind.
test("monitoring alarms on a web guest reaper run that left candidates behind", () => {
  const source = readLibSource("lib/monitoring.ts");
  const pattern = createWebGuestReaperSaturationFilterPattern().logPatternString;

  assert.match(pattern, /\$\.message\.action = "web_guest_reaper_completed"/);
  assert.match(pattern, /\$\.message\.finished IS FALSE/);
  assert.match(source, /"WebGuestReaperSaturationMetricFilter"/);
  assert.match(source, /logGroup: props\.webGuestReaperFn\.logGroup/);
  assert.match(source, /new cloudwatch\.Alarm\(scope, "WebGuestReaperSaturatedAlarm"/);
});

test("ci-cd grants the release workflow permission to invoke the web guest reaper Lambda", () => {
  const source = readLibSource("lib/ci-cd.ts");

  assert.match(source, /sid: "InvokeWebGuestReaperLambda"/);
  assert.match(source, /resources: \[props\.webGuestReaperFn\.functionArn\]/);
});
