import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createGeneratedMediaPromotionScheduleReadStatement,
} from "../ci-cd";
import {
  generatedMediaPromotionScheduleExpression,
  generatedMediaPromotionScheduleName,
} from "./generated-media-promotion";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("generated-media promotion schedule also runs bounded media-blob cleanup", () => {
  assert.equal(generatedMediaPromotionScheduleExpression, "rate(1 minute)");
  assert.equal(
    generatedMediaPromotionScheduleName,
    "flashcards-open-source-app-generated-media-promotion",
  );
  const handlerSource = readSource(
    "../../apps/backend/src/entrypoints/scheduledJobs/lambda-generated-media-promotion.ts",
  );
  assert.match(handlerSource, /mediaBlobCleanupMaximumCandidates = 5/u);
  assert.match(handlerSource, /mediaBlobCleanupLeaseDurationMs = 60_000/u);
  assert.match(
    handlerSource,
    /generatedMediaPromotionFinalizationReserveMs = 10_000/u,
  );
  assert.match(handlerSource, /runMediaBlobCleanupBatch/u);
  assert.match(handlerSource, /runGeneratedMediaPromotionBatch/u);
  assert.ok(
    handlerSource.indexOf("runPromotionFn") <
      handlerSource.indexOf("runCleanupFn"),
  );
  const scheduleSource = readSource(
    "lib/scheduled-jobs/generated-media-promotion.ts",
  );
  assert.match(
    scheduleSource,
    /name: generatedMediaPromotionScheduleName/u,
  );
  assert.match(
    scheduleSource,
    /MEDIA_BLOB_CLEANUP_ENABLED: props\.mediaBlobCleanupEnabled \? "true" : "false"/u,
  );
  const stackSource = readSource("lib/stack.ts");
  assert.match(
    stackSource,
    /scheduleState: generatedMediaPromotionScheduleState/u,
  );
  assert.match(stackSource, /mediaBlobCleanupEnabled,/u);
  assert.match(
    stackSource,
    /if \(value === undefined\) return false;/u,
  );
  assert.match(
    stackSource,
    /mediaBlobCleanupEnabled must be true or false/u,
  );
});

test("shared worker has exact permanent-prefix access and no public route", () => {
  const scheduleSource = readSource(
    "lib/scheduled-jobs/generated-media-promotion.ts",
  );
  assert.match(scheduleSource, /actions: \["s3:DeleteObject"\]/u);
  assert.match(
    scheduleSource,
    /Null:\s*\{\s*"s3:if-match": "false"/u,
  );
  assert.equal(
    scheduleSource.match(
      /arnForObjects\("media\/blobs\/sha256\/\*"\)/gu,
    )?.length,
    3,
  );
  assert.doesNotMatch(scheduleSource, /arnForObjects\("media\/blobs\/\*"\)/u);
  assert.match(
    scheduleSource,
    /actions: \["s3:GetObject"\],[\s\S]{0,100}media\/uploads\/\*/u,
  );
  assert.doesNotMatch(
    scheduleSource,
    /actions: \[[^\]]*"s3:DeleteObject"[^\]]*\][\s\S]{0,120}media\/uploads/u,
  );

  const gatewaySource = readSource("lib/gateways/api-gateway.ts");
  assert.doesNotMatch(
    gatewaySource,
    /media.blob.cleanup|media-blob-cleanup|blob-cleanup/iu,
  );
});

test("release disables cleanup until migration 0103 is confirmed", () => {
  for (const relativePath of [
    "../../.github/workflows/aws-web-release.yml",
    "../../scripts/deploy/bootstrap.sh",
  ]) {
    const source = readSource(relativePath);
    const disabled = source.indexOf(
      "generatedMediaPromotionScheduleState=DISABLED",
    );
    const cleanupDisabled = source.indexOf(
      "mediaBlobCleanupEnabled=false",
    );
    const migration = source.indexOf(
      "--require-migration 0103_ai_chat_initiating_auth_classification.sql",
    );
    const enabled = source.indexOf(
      "generatedMediaPromotionScheduleState=ENABLED",
    );
    const cleanupEnabled = source.indexOf(
      "mediaBlobCleanupEnabled=true",
    );
    const verification = source.indexOf(
      "check-multipart-completion-reconciliation-schedule.sh",
      enabled,
    );
    assert.ok(disabled >= 0);
    assert.ok(cleanupDisabled > disabled);
    assert.ok(cleanupDisabled < migration);
    assert.ok(migration > disabled);
    assert.ok(enabled > migration);
    assert.ok(cleanupEnabled > enabled);
    assert.ok(cleanupEnabled < verification);
    assert.ok(verification > enabled);
  }

  const outputsSource = readSource("lib/outputs.ts");
  assert.match(outputsSource, /"GeneratedMediaPromotionScheduleName"/u);
  const verificationScript = readSource(
    "../../scripts/checks/check-multipart-completion-reconciliation-schedule.sh",
  );
  assert.match(
    verificationScript,
    /check_schedule "GeneratedMediaPromotionScheduleName"/u,
  );
});

test("release verification can read only the exact generated-media schedule", () => {
  const scheduleArn =
    "arn:aws:scheduler:eu-west-1:123456789012:schedule/default/flashcards-open-source-app-generated-media-promotion";
  assert.deepEqual(
    createGeneratedMediaPromotionScheduleReadStatement(
      scheduleArn,
    ).toStatementJson(),
    {
      Action: "scheduler:GetSchedule",
      Effect: "Allow",
      Resource: scheduleArn,
      Sid: "ReadGeneratedMediaPromotionSchedule",
    },
  );

  const stackSource = readSource("lib/stack.ts");
  assert.match(
    stackSource,
    /generatedMediaPromotionScheduleArn:[\s\S]*generatedMediaPromotionResult\.promotionScheduleArn/u,
  );
  const ciCdSource = readSource("lib/ci-cd.ts");
  assert.doesNotMatch(
    ciCdSource,
    /actions:\s*\[[^\]]*"scheduler:\*"/u,
  );
  assert.doesNotMatch(
    ciCdSource,
    /resources:\s*\[[^\]]*"\*"[^\]]*\][\s\S]{0,160}scheduler:GetSchedule/u,
  );
});
