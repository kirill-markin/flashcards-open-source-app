import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  streakLeaderboardSnapshotScheduleExpression,
  streakLeaderboardSnapshotScheduleHours,
} from "./streak-leaderboard";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("streak leaderboard snapshot is scheduled daily at 12:00 UTC", () => {
  assert.equal(streakLeaderboardSnapshotScheduleHours, 24);
  assert.equal(streakLeaderboardSnapshotScheduleExpression, "cron(0 12 * * ? *)");
});

test("streak leaderboard construct creates the daily schedule and snapshot Lambda", () => {
  const source = readLibSource("lib/streak-leaderboard.ts");

  assert.match(source, /new lambdaNodejs\.NodejsFunction\(scope, "StreakLeaderboardSnapshotHandler"/);
  assert.match(
    source,
    /entry: resolveFromRepoRoot\("apps", "backend", "src", "entrypoints", "lambda-streak-leaderboard-snapshot\.ts"\)/,
  );
  assert.match(source, /DB_SECRET_ARN: props\.backendDbSecret\.secretArn/);
  assert.equal(source.includes("REPORTING_DB_SECRET_ARN"), false);
  assert.equal(source.includes("s3.Bucket"), false);
  assert.match(source, /new scheduler\.CfnSchedule\(scope, "StreakLeaderboardSnapshotDailySchedule"/);
  assert.match(source, /scheduleExpression: streakLeaderboardSnapshotScheduleExpression/);
  assert.match(source, /new iam\.Role\(scope, "StreakLeaderboardSnapshotSchedulerRole"/);
  assert.match(source, /actions: \["lambda:InvokeFunction"\]/);
});

test("stack wires the streak leaderboard snapshot function into monitoring, ci-cd, and outputs", () => {
  const source = readLibSource("lib/stack.ts");

  assert.match(source, /const streakLeaderboardResult = streakLeaderboard\(this, \{/);
  assert.match(source, /backendDbSecret: dbResult\.backendDbSecret,/);
  assert.match(source, /streakLeaderboardSnapshotFn: streakLeaderboardResult\.snapshotFunction,/);
  assert.match(source, /streakLeaderboardSnapshotFunction: streakLeaderboardResult\.snapshotFunction,/);
});

test("monitoring alarms cover streak leaderboard snapshot Lambda errors and snapshot staleness", () => {
  const source = readLibSource("lib/monitoring.ts");

  assert.match(source, /new cloudwatch\.Alarm\(scope, "StreakLeaderboardSnapshotLambdaErrorAlarm"/);
  assert.match(source, /props\.streakLeaderboardSnapshotFn\.metricErrors\(/);
  assert.match(source, /new cloudwatch\.Alarm\(scope, "StreakLeaderboardSnapshotStaleAlarm"/);
  assert.match(source, /props\.streakLeaderboardSnapshotFn\.metricInvocations\(/);
  assert.match(source, /comparisonOperator: cloudwatch\.ComparisonOperator\.LESS_THAN_THRESHOLD/);
  assert.match(source, /treatMissingData: cloudwatch\.TreatMissingData\.BREACHING/);
});

test("ci-cd grants the release workflow permission to invoke the streak leaderboard snapshot Lambda", () => {
  const source = readLibSource("lib/ci-cd.ts");

  assert.match(source, /sid: "InvokeStreakLeaderboardSnapshotLambda"/);
  assert.match(source, /resources: \[props\.streakLeaderboardSnapshotFn\.functionArn\]/);
});
