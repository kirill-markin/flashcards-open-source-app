import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type DatabaseExecutor } from "../../../database";
import { GeneratedMediaPromotionStorageTerminalError } from "../../../mediaAssets/storage";
import { testObservationScope } from "../../../mediaAssets/storage/testHelpers";
import { processSyncPull } from "../../../sync";
import { withPostgresIntegrationFixture } from "../../../testSupport/postgresIntegration";
import { extractMarkdownImageDestinationUrls } from "../../../workspacePackages/markdownMedia";
import { maximumGeneratedImageAltTextCodePoints } from "../contract";
import {
  claimGeneratedMediaPromotionJobs,
  enqueueGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJobAfterAccessRevocation,
  markGeneratedMediaBlobWriterAmbiguous,
  reserveGeneratedMediaBlobWriter,
  type ClaimedGeneratedMediaPromotionJob,
  type EnqueueGeneratedMediaPromotionJobInput,
} from "./jobs";
import {
  byJobId,
  claim,
  createInput,
  createRun,
  loadPlaceholderConflictStates,
  transition,
  uniqueSha256,
  withSha256,
} from "./jobsPostgresTestSupport";
import {
  applyGeneratedMediaPromotionJob,
  failGeneratedMediaPromotionJob,
  processClaimedGeneratedMediaPromotionJobWithDependencies,
  rescheduleGeneratedMediaPromotionJob,
} from "./processor";

type AccessRevocationBoundaryRow = Readonly<{ revocation_status: string }>;
type HotChangeIdRow = Readonly<{ change_id: string | number }>;

async function callAccessRevocationBoundary(
  executor: DatabaseExecutor,
  job: ClaimedGeneratedMediaPromotionJob,
  expectedCardText: string,
  failedCardText: string,
  errorCode: "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
): Promise<string> {
  const result = await executor.query<AccessRevocationBoundaryRow>(
    `SELECT content.fail_generated_media_promotion_job_after_access_revocation(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19
     ) AS revocation_status`,
    [
      job.jobId, job.leaseToken, job.operationId, job.userId,
      job.workspaceId, job.cardId, job.targetSide, job.altText,
      job.mediaAssetId, job.replicaId, job.stagingStorageKey,
      job.blobStorageKey, job.sha256, job.mimeType, job.sizeBytes,
      expectedCardText, failedCardText, errorCode, 3_600_000,
    ],
  );
  const status = result.rows[0]?.revocation_status;
  if (status === undefined) {
    throw new Error(`Access-revocation boundary returned no status. jobId=${job.jobId}`);
  }
  return status;
}

test("promotion settlement preserves card text when the expected pending marker is absent or duplicated", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const removedInput = withSha256(createInput(fixture, run), uniqueSha256());
    const movedInput = withSha256(createInput(fixture, run), uniqueSha256());
    const duplicatedInput = withSha256(createInput(fixture, run), uniqueSha256());
    const inputs = [removedInput, movedInput, duplicatedInput];
    for (const input of inputs) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const pendingMarker = (input: EnqueueGeneratedMediaPromotionJobInput): string => (
      `![${input.altText}](fcasset:${input.mediaAssetId}?state=pending)`
    );
    const removedMarker = pendingMarker(removedInput);
    const movedMarker = pendingMarker(movedInput);
    const duplicatedMarker = pendingMarker(duplicatedInput);
    await fixture.ownerPool.query(
      `UPDATE content.cards
       SET front_text = front_text || E'\\n\\n' || $1,
           back_text = replace(replace(back_text, $2, ''), $1, '')
             || E'\\n\\n' || $3
       WHERE workspace_id = $4 AND card_id = $5`,
      [
        movedMarker,
        removedMarker,
        duplicatedMarker,
        fixture.workspaceId,
        fixture.cardId,
      ],
    );
    const expectedCard = (await fixture.ownerPool.query<{
      front_text: string; back_text: string;
    }>(
      `SELECT front_text, back_text
       FROM content.cards
       WHERE workspace_id = $1 AND card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    )).rows[0];
    if (expectedCard === undefined) throw new Error("Conflict test card was not found.");
    assert.equal(expectedCard.front_text.includes(movedMarker), true);
    assert.equal(expectedCard.back_text.includes(removedMarker), false);
    assert.equal(expectedCard.back_text.includes(movedMarker), false);
    assert.equal(
      expectedCard.back_text.split(duplicatedMarker).length - 1,
      2,
    );

    const claimed = await claim("placeholder-conflict-worker", inputs.length);
    assert.equal(claimed.length, inputs.length);
    for (const input of inputs) {
      const job = byJobId(claimed, input.jobId);
      const jobResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
        job,
        {
          leaseOwner: job.leaseOwner,
          leaseDurationMs: 60_000,
          maximumJobs: 1,
          deadlineAtMs: Date.now() + 10_000,
          observationScope: testObservationScope,
          signal: new AbortController().signal,
        },
        {
          claimJobsFn: claimGeneratedMediaPromotionJobs,
          reserveWriterFn: reserveGeneratedMediaBlobWriter,
          promoteObjectFn: async () => {},
          applyJobFn: applyGeneratedMediaPromotionJob,
          rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
          failJobFn: async () => {
            assert.fail("The locked apply transaction must terminalize marker conflicts.");
          },
          failAfterAccessRevocationFn: async () => {
            assert.fail("Marker conflicts must not use access-revocation settlement.");
          },
          markWriterAmbiguousFn: markGeneratedMediaBlobWriterAmbiguous,
          nowFn: Date.now,
        },
      );
      assert.equal(jobResult.outcome, "failed");
      assert.equal(
        jobResult.errorCode,
        "GENERATED_IMAGE_PENDING_MARKER_CONFLICT",
      );
    }

    const settledCard = (await fixture.ownerPool.query<{
      front_text: string; back_text: string;
    }>(
      `SELECT front_text, back_text
       FROM content.cards
       WHERE workspace_id = $1 AND card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    )).rows[0];
    assert.deepEqual(settledCard, expectedCard);
    assert.deepEqual(
      await loadPlaceholderConflictStates(fixture, inputs),
      inputs
        .map((input) => ({
          job_id: input.jobId,
          job_state: "failed",
          job_error_code: "GENERATED_IMAGE_PENDING_MARKER_CONFLICT",
          reservation_state: "unreferenced",
          cleanup_scheduled: true,
          media_asset_count: "0",
        }))
        .sort((left, right) => left.job_id.localeCompare(right.job_id)),
    );
  });
});

test("parser-limit Markdown terminalizes success, failure, and revoked jobs without changing card text", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const successInput = withSha256(createInput(fixture, run), uniqueSha256());
    const failureInput = withSha256(createInput(fixture, run), uniqueSha256());
    const revokedInput = withSha256(createInput(fixture, run), uniqueSha256());
    const inputs = [successInput, failureInput, revokedInput];
    for (const input of inputs) {
      assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    }
    const parserLimitMarkdown = "[".repeat(1_001);
    await fixture.ownerPool.query(
      `UPDATE content.cards
       SET back_text = $1
       WHERE workspace_id = $2 AND card_id = $3`,
      [parserLimitMarkdown, fixture.workspaceId, fixture.cardId],
    );
    const claimed = await claim("parser-complexity-worker", inputs.length);
    assert.equal(claimed.length, inputs.length);
    const processorInput = (job: ClaimedGeneratedMediaPromotionJob) => ({
      leaseOwner: job.leaseOwner,
      leaseDurationMs: 60_000,
      maximumJobs: 1,
      deadlineAtMs: Date.now() + 10_000,
      observationScope: testObservationScope,
      signal: new AbortController().signal,
    });
    const dependencies = {
      claimJobsFn: claimGeneratedMediaPromotionJobs,
      reserveWriterFn: reserveGeneratedMediaBlobWriter,
      promoteObjectFn: async () => {},
      applyJobFn: applyGeneratedMediaPromotionJob,
      rescheduleJobFn: rescheduleGeneratedMediaPromotionJob,
      failJobFn: failGeneratedMediaPromotionJob,
      failAfterAccessRevocationFn: failGeneratedMediaPromotionJobAfterAccessRevocation,
      markWriterAmbiguousFn: markGeneratedMediaBlobWriterAmbiguous,
      nowFn: Date.now,
    };

    const successJob = byJobId(claimed, successInput.jobId);
    const successResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      successJob,
      processorInput(successJob),
      dependencies,
    );
    assert.deepEqual(
      { outcome: successResult.outcome, errorCode: successResult.errorCode },
      {
        outcome: "failed",
        errorCode: "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
      },
    );

    const failureJob = byJobId(claimed, failureInput.jobId);
    const failureResult = await processClaimedGeneratedMediaPromotionJobWithDependencies(
      failureJob,
      processorInput(failureJob),
      {
        ...dependencies,
        promoteObjectFn: async () => {
          throw new GeneratedMediaPromotionStorageTerminalError(
            "STAGING_OBJECT_INVALID",
            "The staged generated image failed integrity validation.",
            null,
          );
        },
      },
    );
    assert.deepEqual(
      { outcome: failureResult.outcome, errorCode: failureResult.errorCode },
      {
        outcome: "failed",
        errorCode: "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
      },
    );

    const revokedJob = byJobId(claimed, revokedInput.jobId);
    await reserveGeneratedMediaBlobWriter(revokedJob, Date.now() + 10_000);
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );
    assert.equal(
      await failGeneratedMediaPromotionJobAfterAccessRevocation(
        revokedJob,
        Date.now() + 10_000,
      ),
      "failed_markdown_complexity",
    );

    assert.equal(
      (await fixture.ownerPool.query<{ back_text: string }>(
        `SELECT back_text
         FROM content.cards
         WHERE workspace_id = $1 AND card_id = $2`,
        [fixture.workspaceId, fixture.cardId],
      )).rows[0]?.back_text,
      parserLimitMarkdown,
    );
    assert.deepEqual(
      await loadPlaceholderConflictStates(fixture, inputs),
      inputs
        .map((input) => ({
          job_id: input.jobId,
          job_state: "failed",
          job_error_code: "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
          reservation_state: "unreferenced",
          cleanup_scheduled: true,
          media_asset_count: "0",
        }))
        .sort((left, right) => left.job_id.localeCompare(right.job_id)),
    );
    assert.deepEqual(await claim("parser-complexity-reclaimer", inputs.length), []);
  });
});

test("Markdown-complexity revocation settlement accepts only byte-preserving card text", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const input = withSha256(createInput(fixture, run), uniqueSha256());
    assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    const job = byJobId(await claim("complexity-boundary-worker", 1), input.jobId);
    await reserveGeneratedMediaBlobWriter(job, Date.now() + 10_000);
    const pendingCardText = (await fixture.ownerPool.query<{ back_text: string }>(
      `SELECT back_text
       FROM content.cards
       WHERE workspace_id = $1 AND card_id = $2`,
      [fixture.workspaceId, fixture.cardId],
    )).rows[0]?.back_text;
    if (pendingCardText === undefined) {
      throw new Error("Complexity-boundary fixture card was not found.");
    }
    const failedCardText = pendingCardText.replace(
      `fcasset:${input.mediaAssetId}?state=pending`,
      `fcasset:${input.mediaAssetId}?state=failed`,
    );
    assert.notEqual(failedCardText, pendingCardText);
    await fixture.ownerPool.query(
      "DELETE FROM org.workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
      [fixture.workspaceId, fixture.userId],
    );

    assert.equal(
      await transition(fixture, (executor) => callAccessRevocationBoundary(
        executor,
        job,
        pendingCardText,
        failedCardText,
        "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
      )),
      "stale",
    );
    assert.deepEqual(
      (await fixture.ownerPool.query<{
        card_text: string; job_state: string; reservation_state: string;
      }>(
        `SELECT cards.back_text AS card_text,
                jobs.state AS job_state,
                reservations.state AS reservation_state
         FROM content.cards AS cards
         INNER JOIN content.generated_media_promotion_jobs AS jobs
           ON jobs.workspace_id = cards.workspace_id
          AND jobs.card_id = cards.card_id
         INNER JOIN content.media_blob_writer_reservations AS reservations
           ON reservations.workspace_id = jobs.workspace_id
          AND reservations.media_asset_id = jobs.media_asset_id
          AND reservations.operation_id = jobs.operation_id::text
         WHERE jobs.job_id = $1`,
        [input.jobId],
      )).rows[0],
      {
        card_text: pendingCardText,
        job_state: "leased",
        reservation_state: "active",
      },
    );

    assert.equal(
      await transition(fixture, (executor) => callAccessRevocationBoundary(
        executor,
        job,
        pendingCardText,
        pendingCardText,
        "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
      )),
      "failed",
    );
    assert.equal(
      (await fixture.ownerPool.query<{ back_text: string }>(
        `SELECT back_text
         FROM content.cards
         WHERE workspace_id = $1 AND card_id = $2`,
        [fixture.workspaceId, fixture.cardId],
      )).rows[0]?.back_text,
      pendingCardText,
    );
    assert.deepEqual(
      await loadPlaceholderConflictStates(fixture, [input]),
      [{
        job_id: input.jobId,
        job_state: "failed",
        job_error_code: "GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT",
        reservation_state: "unreferenced",
        cleanup_scheduled: true,
        media_asset_count: "0",
      }],
    );
  });
});

test("ready promotion sync pages the media asset before the ready card", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const input = withSha256(createInput(fixture, run), uniqueSha256());
    assert.equal((await enqueueGeneratedMediaPromotionJob(input)).outcome, "created");
    const pendingChange = await fixture.ownerPool.query<HotChangeIdRow>(
      `SELECT change_id
       FROM sync.hot_changes
       WHERE workspace_id = $1
         AND entity_type = 'card'
         AND entity_id = $2
         AND operation_id = $3
       ORDER BY change_id DESC
       LIMIT 1`,
      [fixture.workspaceId, fixture.cardId, input.operationId],
    );
    const pendingChangeId = Number(pendingChange.rows[0]?.change_id);
    assert.equal(Number.isSafeInteger(pendingChangeId), true);

    const job = byJobId(await claim("sync-order-worker", 1), input.jobId);
    const writer = await reserveGeneratedMediaBlobWriter(job, Date.now() + 10_000);
    await applyGeneratedMediaPromotionJob(writer, Date.now() + 10_000);
    const installationId = randomUUID();

    const firstPage = await processSyncPull(
      fixture.workspaceId,
      fixture.userId,
      {
        installationId,
        platform: "web",
        appVersion: "postgres-integration",
        afterHotChangeId: pendingChangeId,
        limit: 1,
        includeMediaAssets: true,
      },
    );
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.changes.length, 1);
    assert.equal(firstPage.changes[0]?.entityType, "media_asset");
    assert.equal(firstPage.changes[0]?.entityId, input.mediaAssetId);

    const secondPage = await processSyncPull(
      fixture.workspaceId,
      fixture.userId,
      {
        installationId,
        platform: "web",
        appVersion: "postgres-integration",
        afterHotChangeId: firstPage.nextHotChangeId,
        limit: 1,
        includeMediaAssets: true,
      },
    );
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.changes.length, 1);
    const readyCardChange = secondPage.changes[0];
    assert.equal(readyCardChange?.entityType, "card");
    assert.equal(readyCardChange?.entityId, input.cardId);
    if (readyCardChange?.entityType !== "card") {
      throw new Error("Second sync page did not contain the ready card.");
    }
    assert.deepEqual(
      extractMarkdownImageDestinationUrls(readyCardChange.payload.backText),
      [`fcasset:${input.mediaAssetId}`],
    );
  });
});

test("promotion job payload uses Unicode code points for alt-text limits", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const altText = "😀".repeat(maximumGeneratedImageAltTextCodePoints);
    const input = {
      ...createInput(fixture, run),
      altText,
    };

    assert.deepEqual(
      await enqueueGeneratedMediaPromotionJob(input),
      {
        outcome: "created",
        jobId: input.jobId,
        placeholderApplied: true,
      },
    );
    const jobs = await claim("unicode-alt-text-worker", 1);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.jobId, input.jobId);
    assert.equal(jobs[0]?.altText, altText);
    assert.equal(
      Array.from(jobs[0]?.altText ?? "").length,
      maximumGeneratedImageAltTextCodePoints,
    );
  });
});

test("promotion job payload rejects raw alt text outside the shared contract", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const run = await createRun(fixture);
    const input = createInput(fixture, run);
    for (const altText of [
      "line\nbreak",
      "tab\ttext",
      "\nleading-c0",
      "trailing-c0\t",
      "nul\u0000text",
      "unit\u001fseparator",
      "\u007fleading-del",
      "trailing-del\u007f",
      "delete\u007ftext",
      "\u0085leading-c1",
      "trailing-c1\u009f",
      "c1\u009ftext",
      "😀".repeat(maximumGeneratedImageAltTextCodePoints + 1),
      ` ${"😀".repeat(maximumGeneratedImageAltTextCodePoints)} `,
    ]) {
      await assert.rejects(
        enqueueGeneratedMediaPromotionJob({ ...input, altText }),
        (error: unknown) =>
          error instanceof TypeError
          && error.message.includes("without control characters"),
      );
    }
  });
});

