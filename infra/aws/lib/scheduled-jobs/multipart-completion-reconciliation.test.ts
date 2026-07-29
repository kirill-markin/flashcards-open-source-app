import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createMultipartCompletionReconciliationFailureFilterPattern,
  multipartCompletionReconciliationFailureMetricValue,
} from "../monitoring";
import {
  createMultipartCompletionReconciliationScheduleReadStatement,
} from "../ci-cd";
import {
  createMultipartCompletionReconciliationListBucketStatement,
  multipartCompletionReconciliationScheduleExpression,
  multipartCompletionReconciliationScheduleName,
} from "./multipart-completion-reconciliation";

function readLibSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("multipart completion reconciliation is scheduled every minute", () => {
  assert.equal(
    multipartCompletionReconciliationScheduleExpression,
    "rate(1 minute)",
  );
  assert.equal(
    multipartCompletionReconciliationScheduleName,
    "flashcards-open-source-app-multipart-completion-reconciliation",
  );
});

test("multipart completion reconciliation Lambda has bounded runtime and exact S3 access", () => {
  const source = readLibSource(
    "lib/scheduled-jobs/multipart-completion-reconciliation.ts",
  );

  assert.match(
    source,
    /new lambdaNodejs\.NodejsFunction\([\s\S]*"MultipartCompletionReconciliationHandler"/,
  );
  assert.match(
    source,
    /lambda-multipart-completion-reconciliation\.ts/,
  );
  assert.match(source, /timeout: cdk\.Duration\.minutes\(2\)/);
  assert.match(source, /memorySize: 512/);
  assert.match(source, /loggingFormat: lambda\.LoggingFormat\.JSON/);
  assert.match(
    source,
    /applicationLogLevelV2: lambda\.ApplicationLogLevel\.INFO/,
  );
  assert.match(
    source,
    /systemLogLevelV2: lambda\.SystemLogLevel\.INFO/,
  );
  assert.match(source, /subnetType: ec2\.SubnetType\.PRIVATE_WITH_EGRESS/);
  assert.match(source, /DB_SECRET_ARN: props\.backendDbSecret\.secretArn/);
  assert.match(
    source,
    /MEDIA_ASSETS_S3_BUCKET_NAME: props\.mediaAssetsBucket\.bucketName/,
  );
  assert.match(
    source,
    /"media\/uploads\/workspaces\/\*\/assets\/\*\/sessions\/\*"/,
  );
  assert.match(source, /"media\/blobs\/sha256\/\*"/);
  assert.match(source, /actions: \["s3:GetObject"\]/);
  assert.match(source, /actions: \["s3:PutObject"\]/);
  assert.match(source, /actions: \["s3:ListMultipartUploadParts"\]/);
  assert.match(source, /actions: \["s3:ListBucket"\]/);
  assert.doesNotMatch(source, /s3:DeleteObject|s3:AbortMultipartUpload/);
});

test("multipart reconciliation can distinguish missing objects only in its exact prefixes", () => {
  const bucketArn = "arn:aws:s3:::test-media-assets-bucket";

  assert.deepEqual(
    createMultipartCompletionReconciliationListBucketStatement(
      bucketArn,
    ).toStatementJson(),
    {
      Action: "s3:ListBucket",
      Condition: {
        StringLike: {
          "s3:prefix": [
            "media/uploads/workspaces/*/assets/*/sessions/*",
            "media/blobs/sha256/*",
          ],
        },
      },
      Effect: "Allow",
      Resource: bucketArn,
      Sid: "ListMultipartCompletionReconciliationObjects",
    },
  );
});

test("multipart completion reconciliation schedule can invoke only its Lambda", () => {
  const source = readLibSource(
    "lib/scheduled-jobs/multipart-completion-reconciliation.ts",
  );

  assert.match(
    source,
    /new scheduler\.CfnSchedule\([\s\S]*"MultipartCompletionReconciliationSchedule"/,
  );
  assert.match(
    source,
    /scheduleExpression: multipartCompletionReconciliationScheduleExpression/,
  );
  assert.match(
    source,
    /name: multipartCompletionReconciliationScheduleName/,
  );
  assert.match(source, /state: props\.scheduleState/);
  assert.match(
    source,
    /new iam\.Role\([\s\S]*"MultipartCompletionReconciliationSchedulerRole"/,
  );
  assert.match(source, /actions: \["lambda:InvokeFunction"\]/);
  assert.match(source, /resources: \[reconciliationFunction\.functionArn\]/);
});

test("stack wires multipart reconciliation into monitoring without an HTTP route", () => {
  const stackSource = readLibSource("lib/stack.ts");
  const apiGatewaySource = readLibSource("lib/gateways/api-gateway.ts");

  assert.match(
    stackSource,
    /const multipartCompletionReconciliationResult =[\s\S]*multipartCompletionReconciliation\(this, \{/,
  );
  assert.match(
    stackSource,
    /multipartCompletionReconciliationFn:[\s\S]*multipartCompletionReconciliationResult\.reconciliationFunction/,
  );
  assert.match(
    stackSource,
    /scheduleState: multipartCompletionReconciliationScheduleState/,
  );
  assert.match(
    stackSource,
    /if \(value === undefined\) \{[\s\S]*return "DISABLED"/,
  );
  assert.doesNotMatch(
    apiGatewaySource,
    /multipartCompletionReconciliation|multipart-completion-reconciliation/,
  );
});

test("monitoring covers worker errors, staleness, and terminal job failures", () => {
  const source = readLibSource("lib/monitoring.ts");
  const pattern =
    createMultipartCompletionReconciliationFailureFilterPattern()
      .logPatternString;

  assert.match(
    pattern,
    /multipart_completion_reconciliation_job_terminally_failed/,
  );
  assert.doesNotMatch(pattern, /message\.failed/);
  assert.doesNotMatch(pattern, /message\.details\.failed/);
  const failedEnvelope = {
    timestamp: "2026-07-29T00:00:00.000Z",
    level: "INFO",
    requestId: "request-1",
    message: {
      action: "multipart_completion_reconciliation_job_terminally_failed",
      attemptToken: "attempt-1",
      errorCode: "RETRY_EXHAUSTED",
    },
  };
  assert.equal(
    multipartCompletionReconciliationFailureMetricValue,
    "1",
  );
  assert.equal(
    failedEnvelope.message.action,
    "multipart_completion_reconciliation_job_terminally_failed",
  );
  assert.match(
    source,
    /metricValue: multipartCompletionReconciliationFailureMetricValue/,
  );
  assert.match(
    source,
    /"MultipartCompletionReconciliationLambdaErrorAlarm"/,
  );
  assert.match(source, /"MultipartCompletionReconciliationStaleAlarm"/);
  assert.match(
    source,
    /"MultipartCompletionReconciliationFailureMetricFilter"/,
  );
  assert.match(
    source,
    /"MultipartCompletionReconciliationFailedJobsAlarm"/,
  );
});

test("release deploys the schedule disabled, migrates, then enables and verifies it", () => {
  const workflow = readLibSource(
    "../../.github/workflows/aws-web-release.yml",
  );
  const disabledDeploy = workflow.indexOf(
    "multipartCompletionReconciliationScheduleState=DISABLED",
  );
  const requiredMigration = workflow.indexOf(
    "--require-migration 0101_multipart_foreground_completion_fencing.sql",
  );
  const enabledDeploy = workflow.indexOf(
    "multipartCompletionReconciliationScheduleState=ENABLED",
  );
  const scheduleVerification = workflow.indexOf(
    "check-multipart-completion-reconciliation-schedule.sh",
    enabledDeploy,
  );

  assert.ok(disabledDeploy >= 0);
  assert.ok(requiredMigration > disabledDeploy);
  assert.ok(enabledDeploy > requiredMigration);
  assert.ok(scheduleVerification > enabledDeploy);
  assert.match(
    workflow,
    /name: Verify reconciliation schedule is enabled/,
  );

  const outputsSource = readLibSource("lib/outputs.ts");
  assert.match(
    outputsSource,
    /"MultipartCompletionReconciliationScheduleName"/,
  );
  const verificationScript = readLibSource(
    "../../scripts/checks/check-multipart-completion-reconciliation-schedule.sh",
  );
  assert.match(
    verificationScript,
    /OutputKey=='MultipartCompletionReconciliationScheduleName'/,
  );
  assert.match(verificationScript, /aws scheduler get-schedule/);
  assert.match(verificationScript, /SCHEDULE_STATE" != "ENABLED"/);

  const bootstrapScript = readLibSource(
    "../../scripts/deploy/bootstrap.sh",
  );
  const bootstrapDisabled = bootstrapScript.indexOf(
    "multipartCompletionReconciliationScheduleState=DISABLED",
  );
  const bootstrapMigration = bootstrapScript.indexOf(
    "--require-migration 0101_multipart_foreground_completion_fencing.sql",
  );
  const bootstrapEnabled = bootstrapScript.indexOf(
    "multipartCompletionReconciliationScheduleState=ENABLED",
  );
  const bootstrapVerification = bootstrapScript.indexOf(
    "check-multipart-completion-reconciliation-schedule.sh",
  );
  assert.ok(bootstrapDisabled >= 0);
  assert.ok(bootstrapMigration > bootstrapDisabled);
  assert.ok(bootstrapEnabled > bootstrapMigration);
  assert.ok(bootstrapVerification > bootstrapEnabled);
});

test("release verification can read only the exact reconciliation schedule", () => {
  const scheduleArn =
    "arn:aws:scheduler:eu-west-1:123456789012:schedule/default/flashcards-open-source-app-multipart-completion-reconciliation";
  assert.deepEqual(
    createMultipartCompletionReconciliationScheduleReadStatement(
      scheduleArn,
    ).toStatementJson(),
    {
      Action: "scheduler:GetSchedule",
      Effect: "Allow",
      Resource: scheduleArn,
      Sid: "ReadMultipartCompletionReconciliationSchedule",
    },
  );

  const stackSource = readLibSource("lib/stack.ts");
  assert.match(
    stackSource,
    /multipartCompletionReconciliationScheduleArn:[\s\S]*multipartCompletionReconciliationResult\.reconciliationScheduleArn/,
  );
  const ciCdSource = readLibSource("lib/ci-cd.ts");
  assert.doesNotMatch(
    ciCdSource,
    /actions:\s*\[[^\]]*"scheduler:\*"/,
  );
  assert.doesNotMatch(
    ciCdSource,
    /resources:\s*\[[^\]]*"\*"[^\]]*\][\s\S]{0,160}scheduler:GetSchedule/,
  );
});
