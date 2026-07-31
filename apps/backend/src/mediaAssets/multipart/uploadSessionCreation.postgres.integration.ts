import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import { HttpError } from "../../shared/errors";
import { getHttpErrorResponseHeaders } from "../../server/httpErrorResponseHeaders";
import { createBackendObservationScope } from "../../observability/sentry";
import {
  createMultipartUploadSessionAtApplicationBoundary,
  type MultipartUploadSessionCreationApplicationDependencies,
} from "./creationBoundary";
import {
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspace,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  recordMediaAssetUploadSessionForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
} from "../uploadSessions";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
} from "../storageKeys";
import type {
  MediaAssetUploadSession,
  MediaAssetUploadSessionCreateInput,
} from "../types";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../testSupport/postgresIntegration";

type CountRow = Readonly<{ count: number }>;
type ClaimStateRow = Readonly<{
  media_upload_session_id: string | null;
  state: string;
}>;
type BeginCompletionRow = Readonly<{
  attempt_status: string;
}>;
type FinalizedRecoveryPendingCode =
  | "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS"
  | "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS";
type FinalizedRecoveryTransition = (
  fixture: PostgresIntegrationFixture,
  session: MediaAssetUploadSession,
) => Promise<void>;
type SqlValue = string | number | null;

const multipartCompletionPayloadRow = `ROW(
  $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
)::content.multipart_media_blob_writer_attempt_payload`;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createUploadInput(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): MediaAssetUploadSessionCreateInput {
  return {
    mediaAssetId,
    mimeType: "application/octet-stream",
    sizeBytes: 42,
    sha256: digest(randomUUID()),
    partSizeBytes: 42,
    partCount: 1,
    sourceUrl: null,
    createdAt: fixture.createdAt,
    clientUpdatedAt: fixture.createdAt,
    lastModifiedByReplicaId: fixture.replicaId,
    lastOperationId: randomUUID(),
  };
}

function applicationObservationScope(
  fixture: PostgresIntegrationFixture,
): ReturnType<typeof createBackendObservationScope> {
  return createBackendObservationScope(
    "backend-api",
    `multipart-create-${randomUUID()}`,
    "/workspaces/:workspaceId/media-assets/upload-sessions",
    "POST",
    fixture.userId,
    fixture.workspaceId,
    null,
    null,
    null,
    null,
    null,
  );
}

function createApplicationDependencies(
  createMultipartMediaAssetUploadFn:
    MultipartUploadSessionCreationApplicationDependencies[
      "createMultipartMediaAssetUploadFn"
    ],
  abortMultipartMediaAssetUploadUntilDeadlineFn:
    MultipartUploadSessionCreationApplicationDependencies[
      "abortMultipartMediaAssetUploadUntilDeadlineFn"
    ],
): MultipartUploadSessionCreationApplicationDependencies {
  return {
    abortMultipartMediaAssetUploadUntilDeadlineFn,
    acquireCreationClaimFn:
      acquireMediaAssetUploadSessionCreationClaimForWorkspace,
    createMediaAssetFromAvailableBlobForWorkspaceFn:
      createMediaAssetFromAvailableBlobForWorkspace,
    createMultipartMediaAssetUploadFn,
    loadCreationReplayFn:
      loadMediaAssetUploadSessionCreationReplayForWorkspace,
    recordUploadSessionWithCreationClaimFn:
      recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
    releaseCreationClaimFn:
      releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  };
}

async function createAtBoundary(
  fixture: PostgresIntegrationFixture,
  input: MediaAssetUploadSessionCreateInput,
  sessionId: string,
  claimToken: string,
  claimLeaseDurationMs: number,
  dependencies: MultipartUploadSessionCreationApplicationDependencies,
): ReturnType<typeof createMultipartUploadSessionAtApplicationBoundary> {
  return createMultipartUploadSessionAtApplicationBoundary(
    fixture.userId,
    fixture.workspaceId,
    sessionId,
    claimToken,
    input,
    buildMediaMultipartUploadStagingStorageKey(
      fixture.workspaceId,
      input.mediaAssetId,
      sessionId,
    ),
    buildMediaBlobStorageKey(input.sha256),
    applicationObservationScope(fixture),
    new AbortController().signal,
    claimLeaseDurationMs,
    dependencies,
  );
}

async function countNonterminalSessions(
  fixture: PostgresIntegrationFixture,
  mediaAssetId: string,
): Promise<number> {
  const result = await fixture.ownerPool.query<CountRow>(
    `SELECT count(*)::int AS count
     FROM content.media_upload_sessions
     WHERE workspace_id=$1
       AND media_asset_id=$2
       AND state IN ('active','completing','aborting')`,
    [fixture.workspaceId, mediaAssetId],
  );
  return result.rows[0]?.count ?? -1;
}

function toMultipartCompletionPayloadValues(
  fixture: PostgresIntegrationFixture,
  session: MediaAssetUploadSession,
): ReadonlyArray<SqlValue> {
  return [
    fixture.userId,
    fixture.workspaceId,
    session.sessionId,
    session.mediaAssetId,
    session.lastModifiedByReplicaId,
    session.lastOperationId,
    session.mediaBlobSha256,
    session.stagingStorageKey,
    session.blobStorageKey,
    session.s3UploadId,
    session.mimeType,
    session.sizeBytes,
    session.partSizeBytes,
    session.partCount,
    session.sourceUrl,
    session.assetCreatedAt,
    session.clientUpdatedAt,
    session.expiresAt,
    "passthrough-v1",
    digest("completed-parts"),
  ];
}

async function beginCompletionAttempt(
  fixture: PostgresIntegrationFixture,
  session: MediaAssetUploadSession,
): Promise<void> {
  const client = await fixture.runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT
         set_config('app.user_id',$1,true),
         set_config('app.workspace_id',$2,true)`,
      [fixture.userId, fixture.workspaceId],
    );
    const result = await client.query<BeginCompletionRow>(
      `SELECT *
       FROM content.begin_media_upload_session_completion_attempt_with_owner(
         $1,$2,${multipartCompletionPayloadRow}
       )`,
      [
        randomUUID(),
        60_000,
        ...toMultipartCompletionPayloadValues(fixture, session),
      ],
    );
    assert.equal(result.rows[0]?.attempt_status, "acquired");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertFinalizedPersistenceRecoveryPending(
  fixture: PostgresIntegrationFixture,
  expectedCode: FinalizedRecoveryPendingCode,
  transition: FinalizedRecoveryTransition,
): Promise<void> {
  const input = createUploadInput(fixture, randomUUID());
  let committedSession: MediaAssetUploadSession | null = null;
  let s3CreateCalls = 0;
  const baseDependencies = createApplicationDependencies(
    async (storageInput) => {
      s3CreateCalls += 1;
      return {
        storageKey: storageInput.stagingStorageKey,
        s3UploadId: `finalized-recovery-upload-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    },
    async () => {},
  );
  const dependencies: MultipartUploadSessionCreationApplicationDependencies = {
    ...baseDependencies,
    loadCreationReplayFn: async (...arguments_) => {
      if (committedSession === null) {
        throw new Error(
          "Finalized persistence recovery reached replay before committing its upload session.",
        );
      }
      await transition(fixture, committedSession);
      return baseDependencies.loadCreationReplayFn(...arguments_);
    },
    recordUploadSessionWithCreationClaimFn: async (...arguments_) => {
      const result =
        await baseDependencies.recordUploadSessionWithCreationClaimFn(
          ...arguments_
        );
      if (result.status !== "upload_required") {
        throw new Error(
          "Finalized persistence recovery unexpectedly reused available media.",
        );
      }
      committedSession = result.uploadSession;
      throw new DatabaseCommitOutcomeUnknownError(
        new Error(
          "The committed upload-session persistence response was lost.",
        ),
      );
    },
  };

  await assert.rejects(
    createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, expectedCode);
      const retryAfterSeconds = error.details?.retryAfterSeconds;
      assert.ok(retryAfterSeconds !== undefined);
      assert.deepEqual(
        getHttpErrorResponseHeaders(error),
        [["Retry-After", retryAfterSeconds.toString()]],
      );
      return true;
    },
  );
  assert.equal(s3CreateCalls, 1);
  assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
}

function collectErrorMessages(error: unknown): ReadonlyArray<string> {
  if (!(error instanceof Error)) return [String(error)];
  const messages = [error.message];
  if (error.cause instanceof AggregateError) {
    return [
      ...messages,
      ...error.cause.errors.flatMap(collectErrorMessages),
    ];
  }
  if (error.cause !== undefined) {
    return [...messages, ...collectErrorMessages(error.cause)];
  }
  return messages;
}

test("completion-winning replacement creation returns retryable pending with zero S3 calls", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    const originalSessionId = randomUUID();
    const original = await recordMediaAssetUploadSessionForWorkspace(
      fixture.userId,
      fixture.workspaceId,
      originalSessionId,
      input,
      buildMediaMultipartUploadStagingStorageKey(
        fixture.workspaceId,
        input.mediaAssetId,
        originalSessionId,
      ),
      buildMediaBlobStorageKey(input.sha256),
      `original-upload-${randomUUID()}`,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    assert.equal(original.status, "upload_required");
    if (original.status !== "upload_required") return;
    await beginCompletionAttempt(fixture, original.uploadSession);

    let s3CreateCalls = 0;
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `replacement-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );

    await assert.rejects(
      createAtBoundary(
        fixture,
        input,
        randomUUID(),
        randomUUID(),
        60_000,
        dependencies,
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        assert.ok((error.details?.retryAfterSeconds ?? 0) >= 1);
        return true;
      },
    );
    assert.equal(s3CreateCalls, 0);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
  });
});

test("claimed completing session blocks replacement creation with a retryable completion response", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    let s3CreateCalls = 0;
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `claimed-completing-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );
    const original = await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    );
    assert.equal(original.sessionResult.status, "upload_required");
    if (original.sessionResult.status !== "upload_required") return;
    await beginCompletionAttempt(fixture, original.sessionResult.uploadSession);

    await assert.rejects(
      createAtBoundary(
        fixture,
        input,
        randomUUID(),
        randomUUID(),
        60_000,
        dependencies,
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        assert.ok((error.details?.retryAfterSeconds ?? 0) >= 1);
        return true;
      },
    );
    assert.equal(s3CreateCalls, 1);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
  });
});

test("claimed aborting session blocks replacement creation with a retryable creation response", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    let s3CreateCalls = 0;
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `claimed-aborting-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );
    const original = await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    );
    assert.equal(original.sessionResult.status, "upload_required");
    if (original.sessionResult.status !== "upload_required") return;
    const abortTransition = await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET state='aborting'
       WHERE media_upload_session_id=$1`,
      [original.sessionResult.uploadSession.sessionId],
    );
    assert.equal(abortTransition.rowCount, 1);

    await assert.rejects(
      createAtBoundary(
        fixture,
        input,
        randomUUID(),
        randomUUID(),
        60_000,
        dependencies,
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
        );
        assert.ok((error.details?.retryAfterSeconds ?? 0) >= 1);
        return true;
      },
    );
    assert.equal(s3CreateCalls, 1);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
  });
});

test("finalized persistence recovery preserves the retryable completing response", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertFinalizedPersistenceRecoveryPending(
      fixture,
      "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      async (transitionFixture, session) => {
        await beginCompletionAttempt(transitionFixture, session);
      },
    );
  });
});

test("finalized persistence recovery preserves the retryable aborting response", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    await assertFinalizedPersistenceRecoveryPending(
      fixture,
      "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
      async (transitionFixture, session) => {
        const abortTransition = await transitionFixture.ownerPool.query(
          `UPDATE content.media_upload_sessions
           SET state='aborting'
           WHERE media_upload_session_id=$1`,
          [session.sessionId],
        );
        assert.equal(abortTransition.rowCount, 1);
      },
    );
  });
});

test("lost successful create response replays the exact active session without another S3 call", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    let s3CreateCalls = 0;
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `replacement-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );

    const first = await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    );
    assert.equal(first.sessionResult.status, "upload_required");
    if (first.sessionResult.status !== "upload_required") return;

    const replay = await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    );
    assert.equal(replay.sessionResult.status, "upload_required");
    if (replay.sessionResult.status !== "upload_required") return;
    assert.equal(
      replay.sessionResult.uploadSession.sessionId,
      first.sessionResult.uploadSession.sessionId,
    );
    assert.equal(replay.multipartUploadCreated, false);
    assert.equal(s3CreateCalls, 1);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
  });
});

test("delayed S3 creation is aborted before claim expiry and cannot persist after a new claimant wins", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    const leaseDurationMs = 4_000;
    let delayedS3Calls = 0;
    let winningS3Calls = 0;
    const delayedDependencies = createApplicationDependencies(
      async (storageInput) => {
        delayedS3Calls += 1;
        return new Promise<never>((_resolve, reject) => {
          const rejectForAbort = (): void => {
            reject(storageInput.signal.reason);
          };
          storageInput.signal.addEventListener(
            "abort",
            rejectForAbort,
            { once: true },
          );
        });
      },
      async () => {},
    );
    const winningDependencies = createApplicationDependencies(
      async (storageInput) => {
        winningS3Calls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `winning-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );

    const delayedCreate = createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      leaseDurationMs,
      delayedDependencies,
    );
    const winner = (async () => {
      await delay(leaseDurationMs + 100);
      return createAtBoundary(
        fixture,
        input,
        randomUUID(),
        randomUUID(),
        60_000,
        winningDependencies,
      );
    })();

    const [delayedOutcome, winnerOutcome] = await Promise.allSettled([
      delayedCreate,
      winner,
    ]);
    assert.equal(delayedOutcome.status, "rejected");
    assert.ok(delayedOutcome.reason instanceof HttpError);
    assert.equal(
      delayedOutcome.reason.code,
      "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
    );
    assert.equal(winnerOutcome.status, "fulfilled");
    const winningResult = winnerOutcome.value;
    assert.equal(winningResult.sessionResult.status, "upload_required");
    assert.equal(delayedS3Calls, 1);
    assert.equal(winningS3Calls, 1);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 1);
  });
});

test("persistence and claim-release failures still run bounded orphaned S3 cleanup", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    const persistenceError = new Error(
      "Deterministic upload-session persistence failure.",
    );
    const releaseError = new Error(
      "Deterministic exact-claim release failure.",
    );
    let cleanupCalls = 0;
    const baseDependencies = createApplicationDependencies(
      async (storageInput) => ({
        storageKey: storageInput.stagingStorageKey,
        s3UploadId: `orphan-upload-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      async (storageInput) => {
        cleanupCalls += 1;
        assert.equal(storageInput.signal.aborted, false);
      },
    );
    const dependencies: MultipartUploadSessionCreationApplicationDependencies = {
      ...baseDependencies,
      recordUploadSessionWithCreationClaimFn: async () => {
        throw persistenceError;
      },
      releaseCreationClaimFn: async () => {
        throw releaseError;
      },
    };

    await assert.rejects(
      createAtBoundary(
        fixture,
        input,
        randomUUID(),
        randomUUID(),
        60_000,
        dependencies,
      ),
      (error: unknown): boolean => {
        const messages = collectErrorMessages(error);
        assert.ok(messages.some((message) => message.includes(
          persistenceError.message,
        )));
        assert.ok(messages.some((message) => message.includes(
          releaseError.message,
        )));
        return true;
      },
    );
    assert.equal(cleanupCalls, 1);
    assert.equal(await countNonterminalSessions(fixture, input.mediaAssetId), 0);
  });
});

test("committed session replay rejects mismatched immutable create input without S3", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    let s3CreateCalls = 0;
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `replacement-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );
    await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      randomUUID(),
      60_000,
      dependencies,
    );

    await assert.rejects(
      createAtBoundary(
        fixture,
        { ...input, lastOperationId: randomUUID() },
        randomUUID(),
        randomUUID(),
        60_000,
        dependencies,
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_CREATE_REPLAY_MISMATCH",
        );
        assert.match(error.message, /lastOperationId/u);
        return true;
      },
    );
    assert.equal(s3CreateCalls, 1);
  });
});

test("expired exact claims are reclaimed before replacement S3 creation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = createUploadInput(fixture, randomUUID());
    const expiredClaimToken = randomUUID();
    const acquired =
      await acquireMediaAssetUploadSessionCreationClaimForWorkspace(
        fixture.userId,
        fixture.workspaceId,
        input.mediaAssetId,
        input.lastModifiedByReplicaId,
        expiredClaimToken,
        60_000,
      );
    assert.equal(acquired.status, "acquired");
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_session_creation_claims
       SET
         created_at=pg_catalog.clock_timestamp() - interval '3 seconds',
         updated_at=pg_catalog.clock_timestamp() - interval '2 seconds',
         lease_expires_at=pg_catalog.clock_timestamp() - interval '1 second'
       WHERE claim_token=$1`,
      [expiredClaimToken],
    );

    let s3CreateCalls = 0;
    const replacementClaimToken = randomUUID();
    const dependencies = createApplicationDependencies(
      async (storageInput) => {
        s3CreateCalls += 1;
        return {
          storageKey: storageInput.stagingStorageKey,
          s3UploadId: `replacement-upload-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      },
      async () => {},
    );
    const result = await createAtBoundary(
      fixture,
      input,
      randomUUID(),
      replacementClaimToken,
      60_000,
      dependencies,
    );
    assert.equal(result.sessionResult.status, "upload_required");
    assert.equal(s3CreateCalls, 1);
    assert.deepEqual(
      (
        await fixture.ownerPool.query<ClaimStateRow>(
          `SELECT state,media_upload_session_id
           FROM content.media_upload_session_creation_claims
           WHERE claim_token=$1`,
          [expiredClaimToken],
        )
      ).rows[0],
      {
        state: "released",
        media_upload_session_id: null,
      },
    );
    assert.equal(
      (
        await fixture.ownerPool.query<ClaimStateRow>(
          `SELECT state,media_upload_session_id
           FROM content.media_upload_session_creation_claims
           WHERE claim_token=$1`,
          [replacementClaimToken],
        )
      ).rows[0]?.state,
      "finalized",
    );
  });
});
