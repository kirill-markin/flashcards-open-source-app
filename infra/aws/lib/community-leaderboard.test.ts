import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  communityLeaderboardSnapshotScheduleExpression,
  communityLeaderboardSnapshotScheduleHours,
} from "./community-leaderboard";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("community leaderboard snapshot is scheduled hourly", () => {
  assert.equal(communityLeaderboardSnapshotScheduleHours, 1);
  assert.equal(communityLeaderboardSnapshotScheduleExpression, "cron(0 * * * ? *)");
});

test("community leaderboard construct creates the hourly schedule and snapshot Lambda", () => {
  const source = readLibSource("lib/community-leaderboard.ts");

  // A NodejsFunction whose entry is the leaderboard snapshot Lambda handler.
  assert.match(source, /new lambdaNodejs\.NodejsFunction\(scope, "CommunityLeaderboardSnapshotHandler"/);
  assert.match(
    source,
    /entry: resolveFromRepoRoot\("apps", "backend", "src", "entrypoints", "lambda-community-leaderboard-snapshot\.ts"\)/,
  );

  // The job writes to Postgres as backend_app, so it uses the backend (read-write) secret,
  // not the read-only reporting secret used by the global metrics snapshot.
  assert.match(source, /DB_SECRET_ARN: props\.backendDbSecret\.secretArn/);
  assert.equal(source.includes("REPORTING_DB_SECRET_ARN"), false);
  assert.equal(source.includes("s3.Bucket"), false);

  // An hourly EventBridge schedule targeting the snapshot Lambda.
  assert.match(source, /new scheduler\.CfnSchedule\(scope, "CommunityLeaderboardSnapshotHourlySchedule"/);
  assert.match(source, /scheduleExpression: communityLeaderboardSnapshotScheduleExpression/);
  assert.match(source, /new iam\.Role\(scope, "CommunityLeaderboardSnapshotSchedulerRole"/);
  assert.match(source, /actions: \["lambda:InvokeFunction"\]/);
});

test("stack wires the community leaderboard snapshot function into monitoring, ci-cd, and outputs", () => {
  const source = readLibSource("lib/stack.ts");

  assert.match(source, /const communityLeaderboardResult = communityLeaderboard\(this, \{/);
  assert.match(source, /backendDbSecret: dbResult\.backendDbSecret,/);
  assert.match(source, /communityLeaderboardSnapshotFn: communityLeaderboardResult\.snapshotFunction,/);
  assert.match(source, /communityLeaderboardSnapshotFunction: communityLeaderboardResult\.snapshotFunction,/);
});

test("monitoring alarms cover leaderboard snapshot Lambda errors and snapshot staleness", () => {
  const source = readLibSource("lib/monitoring.ts");

  assert.match(source, /new cloudwatch\.Alarm\(scope, "CommunityLeaderboardSnapshotLambdaErrorAlarm"/);
  assert.match(source, /props\.communityLeaderboardSnapshotFn\.metricErrors\(/);
  assert.match(source, /new cloudwatch\.Alarm\(scope, "CommunityLeaderboardSnapshotStaleAlarm"/);
  assert.match(source, /props\.communityLeaderboardSnapshotFn\.metricInvocations\(/);
  assert.match(source, /comparisonOperator: cloudwatch\.ComparisonOperator\.LESS_THAN_THRESHOLD/);
  assert.match(source, /treatMissingData: cloudwatch\.TreatMissingData\.BREACHING/);
});

test("ci-cd grants the release workflow permission to invoke the leaderboard snapshot Lambda", () => {
  const source = readLibSource("lib/ci-cd.ts");

  assert.match(source, /sid: "InvokeCommunityLeaderboardSnapshotLambda"/);
  assert.match(source, /resources: \[props\.communityLeaderboardSnapshotFn\.functionArn\]/);
});
