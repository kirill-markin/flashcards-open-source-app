import assert from "node:assert/strict";
import test from "node:test";
import { createBackendObservationScope } from "../../observability/sentry";
import { DatabaseDeadlineExceededError } from "../../database";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../database/transient";
import {
  GeneratedMediaPromotionStorageTransientError,
} from "../../mediaAssets/storage";
import { HttpError } from "../../shared/errors";
import { InactiveChatRunClaimError } from "../runs/claimFence";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import {
  createGeneratedCardImageOperationDependencies,
  generateCardImageWithDependencies,
  type GeneratedCardImageOperationDependencies,
} from "./operation";
import type { EnqueueGeneratedMediaPromotionJobResult } from "./promotionJobs";
import {
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageStagingOutcomeUnknownError,
} from "./providerTypes";
import type { GeneratedCardImageInput } from "./types";
import { maximumGeneratedImageAltTextCodePoints } from "./contract";

const runId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const cardId = "33333333-3333-4333-8333-333333333333";
const replicaId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const operationKey = "generated-image:1";

function createInput(signal: AbortSignal): GeneratedCardImageInput {
  return {
    runId,
    operationKey,
    sessionId,
    claimToken: "2026-07-24 10:11:12.123456+00",
    userId: "operation-test-user",
    workspaceId,
    cardId,
    targetSide: "back",
    imagePrompt: "Draw a labeled plant cell.",
    altText: "Plant cell diagram",
    replicaId,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker",
        "operation-test-request",
        null,
        null,
        "operation-test-user",
        workspaceId,
        "operation-test-chat-request",
        runId,
        sessionId,
        null,
        null,
      ),
      rootObservation: null,
    },
    signal,
    operationDeadlineMs: Date.now() + 120_000,
  };
}

function createDelayedFailureDependencies(
  error: Error,
  delayMs: number,
): GeneratedCardImageOperationDependencies {
  return {
    assertPreconditionsFn: async () => undefined,
    withOperationLockFn: async (input, callback) => callback(input.signal),
    prepareStagedImageFn: async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
      throw error;
    },
    enqueuePromotionJobFn: async () => {
      throw new Error("Promotion enqueue must not run after staged-image failure.");
    },
  };
}

function createPromotionEnqueueDependencies(
  enqueuePromotionJobFn: GeneratedCardImageOperationDependencies["enqueuePromotionJobFn"],
): GeneratedCardImageOperationDependencies {
  return {
    assertPreconditionsFn: async () => undefined,
    withOperationLockFn: async (input, callback) => callback(input.signal),
    prepareStagedImageFn: async () => ({
      stagingStorageKey: "media/uploads/test",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      reused: false,
    }),
    enqueuePromotionJobFn,
  };
}

test("generated image orchestration stages before durable enqueue", async () => {
  const calls: Array<string> = [];
  const metadata = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const lockSignal = new AbortController().signal;
  const dependencies: GeneratedCardImageOperationDependencies = {
    assertPreconditionsFn: async () => {
      calls.push("preconditions");
    },
    withOperationLockFn: async (lockInput, callback) => {
      calls.push("lock");
      assert.notEqual(lockInput.signal, lockSignal);
      return callback(lockSignal);
    },
    prepareStagedImageFn: async (input) => {
      calls.push("stage");
      assert.equal(input.signal, lockSignal);
      return {
        stagingStorageKey: "media/uploads/test",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        reused: false,
      };
    },
    enqueuePromotionJobFn: async (input, operationMetadata, preparedImage) => {
      calls.push("enqueue");
      assert.equal(input.signal.aborted, false);
      assert.deepEqual(operationMetadata, metadata);
      assert.equal(preparedImage.stagingStorageKey, "media/uploads/test");
      return {
        outcome: "created",
        jobId: metadata.operationId,
        placeholderApplied: true,
      };
    },
  };

  const result = await generateCardImageWithDependencies(
    createInput(new AbortController().signal),
    dependencies,
  );

  assert.deepEqual(calls, ["preconditions", "lock", "stage", "enqueue"]);
  assert.deepEqual(result, {
    status: "queued",
    cardId,
    mediaAssetId: metadata.mediaAssetId,
    targetSide: "back",
    mediaRegistrationApplied: false,
    cardAppendApplied: false,
    placeholderApplied: true,
    reused: false,
    sourceUrl: null,
  });
});

test("provider-start commit-unknown never crosses the provider boundary", async () => {
  const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
    new Error("PostgreSQL response was lost after provider-start commit."),
  );
  let providerCallCount = 0;
  const createdDependencies = createGeneratedCardImageOperationDependencies({
    markProviderStartedFn: async () => {
      throw commitUnknownError;
    },
    generateProviderImageFn: async () => {
      providerCallCount += 1;
      throw new Error("Provider must not run after an ambiguous start fence.");
    },
    normalizeImageBytesForCardFn: async () => {
      throw new Error("Normalization must not run without provider bytes.");
    },
    loadGeneratedMediaStagingObjectFn: async () => null,
    storeGeneratedMediaStagingObjectFn: async () => {
      throw new Error("Storage must not run without provider bytes.");
    },
    enqueueGeneratedMediaPromotionJobFn: async () => {
      throw new Error("Promotion must not run without staged bytes.");
    },
  });

  await assert.rejects(
    generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      {
        ...createdDependencies,
        assertPreconditionsFn: async () => undefined,
        withOperationLockFn: async (lockInput, callback) =>
          callback(lockInput.signal),
      },
    ),
    (error: unknown) => error === commitUnknownError,
  );
  assert.equal(providerCallCount, 0);
});

test("previously-started provider state without staging is authoritative", async () => {
  let providerCallCount = 0;
  const createdDependencies = createGeneratedCardImageOperationDependencies({
    markProviderStartedFn: async () => ({ status: "previously_started" }),
    generateProviderImageFn: async () => {
      providerCallCount += 1;
      throw new Error("Provider must not replay a previously-started operation.");
    },
    normalizeImageBytesForCardFn: async () => {
      throw new Error("Normalization must not run without provider bytes.");
    },
    loadGeneratedMediaStagingObjectFn: async () => null,
    storeGeneratedMediaStagingObjectFn: async () => {
      throw new Error("Storage must not run without provider bytes.");
    },
    enqueueGeneratedMediaPromotionJobFn: async () => {
      throw new Error("Promotion must not run without staged bytes.");
    },
  });

  await assert.rejects(
    generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      {
        ...createdDependencies,
        assertPreconditionsFn: async () => undefined,
        withOperationLockFn: async (lockInput, callback) =>
          callback(lockInput.signal),
      },
    ),
    (error: unknown) =>
      error instanceof GeneratedCardImageProviderOutcomeUnknownError,
  );
  assert.equal(providerCallCount, 0);
});

test("pre-provider staging lookup failure remains safely retryable", async () => {
  const storageError = new GeneratedMediaPromotionStorageTransientError(503);
  let providerStartCallCount = 0;
  let providerCallCount = 0;
  let storeCallCount = 0;
  const createdDependencies = createGeneratedCardImageOperationDependencies({
    markProviderStartedFn: async () => {
      providerStartCallCount += 1;
      return { status: "first_started" };
    },
    generateProviderImageFn: async () => {
      providerCallCount += 1;
      return {
        bytes: Buffer.from("provider-bytes"),
        providerRequestId: "req_pre_provider_storage",
      };
    },
    normalizeImageBytesForCardFn: async (bytes) => ({
      bytes,
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
    }),
    loadGeneratedMediaStagingObjectFn: async () => {
      throw storageError;
    },
    storeGeneratedMediaStagingObjectFn: async () => {
      storeCallCount += 1;
      throw new Error("Staging storage must not run after lookup failure.");
    },
    enqueueGeneratedMediaPromotionJobFn: async () => {
      throw new Error("Promotion must not run after lookup failure.");
    },
  });

  await assert.rejects(
    generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      {
        ...createdDependencies,
        assertPreconditionsFn: async () => undefined,
        withOperationLockFn: async (lockInput, callback) =>
          callback(lockInput.signal),
      },
    ),
    (error: unknown) => error === storageError,
  );
  assert.equal(providerStartCallCount, 0);
  assert.equal(providerCallCount, 0);
  assert.equal(storeCallCount, 0);
});

test("post-provider staging failure is authoritative and preserves its cause", async () => {
  const storageError = new GeneratedMediaPromotionStorageTransientError(503);
  let providerStartCallCount = 0;
  let providerCallCount = 0;
  let storeCallCount = 0;
  const createdDependencies = createGeneratedCardImageOperationDependencies({
    markProviderStartedFn: async () => {
      providerStartCallCount += 1;
      return { status: "first_started" };
    },
    generateProviderImageFn: async () => {
      providerCallCount += 1;
      return {
        bytes: Buffer.from("provider-bytes"),
        providerRequestId: "req_post_provider_storage",
      };
    },
    normalizeImageBytesForCardFn: async (bytes) => ({
      bytes,
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
    }),
    loadGeneratedMediaStagingObjectFn: async () => null,
    storeGeneratedMediaStagingObjectFn: async () => {
      storeCallCount += 1;
      throw storageError;
    },
    enqueueGeneratedMediaPromotionJobFn: async () => {
      throw new Error("Promotion must not run after staging failure.");
    },
  });

  await assert.rejects(
    generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      {
        ...createdDependencies,
        assertPreconditionsFn: async () => undefined,
        withOperationLockFn: async (lockInput, callback) =>
          callback(lockInput.signal),
      },
    ),
    (error: unknown) =>
      error instanceof GeneratedCardImageStagingOutcomeUnknownError
      && error.cause === storageError
      && error.message.includes(`runId=${runId}`)
      && error.message.includes(`operationKey=${operationKey}`),
  );
  assert.equal(providerStartCallCount, 1);
  assert.equal(providerCallCount, 1);
  assert.equal(storeCallCount, 1);
});

test("generated image identity is stable when regenerated wording changes", () => {
  const original = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const regenerated = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const differentOperation = deriveGeneratedCardImageOperationMetadata(
    runId,
    "generated-image:2",
  );

  assert.deepEqual(regenerated, original);
  assert.notEqual(differentOperation.operationId, original.operationId);
  assert.notEqual(differentOperation.mediaAssetId, original.mediaAssetId);
});

test("generated image operation validates raw Unicode length before normalizing alt text", async () => {
  const rawAltText =
    ` ${"😀".repeat(maximumGeneratedImageAltTextCodePoints - 2)} `;
  const altText = rawAltText.trim();
  const metadata = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const dependencies: GeneratedCardImageOperationDependencies = {
    assertPreconditionsFn: async (input) => {
      assert.equal(input.altText, altText);
      assert.equal(
        Array.from(input.altText).length,
        maximumGeneratedImageAltTextCodePoints - 2,
      );
    },
    withOperationLockFn: async (lockInput, callback) => callback(lockInput.signal),
    prepareStagedImageFn: async () => ({
      stagingStorageKey: "media/uploads/unicode-alt-text",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      reused: false,
    }),
    enqueuePromotionJobFn: async (input) => {
      assert.equal(input.altText, altText);
      return {
        outcome: "created",
        jobId: metadata.operationId,
        placeholderApplied: true,
      };
    },
  };

  const result = await generateCardImageWithDependencies(
    {
      ...createInput(new AbortController().signal),
      altText: rawAltText,
    },
    dependencies,
  );
  assert.equal(result.status, "queued");
});

test("generated image operation rejects the shared alt-text control characters", async () => {
  const invalidAltTexts = [
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
    ` ${"😀".repeat(maximumGeneratedImageAltTextCodePoints)} `,
  ] as const;
  const dependencies = createPromotionEnqueueDependencies(async () => {
    throw new Error("Promotion enqueue must not run for invalid alt text.");
  });

  for (const altText of invalidAltTexts) {
    await assert.rejects(
      generateCardImageWithDependencies(
        {
          ...createInput(new AbortController().signal),
          altText,
        },
        dependencies,
      ),
      (error: unknown) =>
        error instanceof HttpError
        && error.message.includes("without control characters"),
    );
  }
});

test("ambiguous enqueue accepts only a confirmed reconciliation result", async () => {
  const metadata = deriveGeneratedCardImageOperationMetadata(runId, operationKey);

  for (const outcome of ["created", "existing"] as const) {
    const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
      new Error("PostgreSQL response was lost after commit."),
    );
    let enqueueCallCount = 0;
    const result = await generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      createPromotionEnqueueDependencies(async () => {
        enqueueCallCount += 1;
        if (enqueueCallCount === 1) {
          throw commitUnknownError;
        }
        return {
          outcome,
          jobId: metadata.operationId,
          placeholderApplied: true,
        };
      }),
    );

    assert.equal(result.status, outcome === "created" ? "queued" : "already_queued");
    assert.equal(enqueueCallCount, 2);
  }
});

test("ambiguous enqueue preserves the original error for inconclusive reconciliation", async () => {
  const metadata = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const inconclusiveResults: ReadonlyArray<unknown> = [
    undefined,
    null,
    { outcome: "pending", jobId: metadata.operationId },
    {
      outcome: "existing",
      jobId: "66666666-6666-4666-8666-666666666666",
      placeholderApplied: true,
    },
  ];

  for (const inconclusiveResult of inconclusiveResults) {
    const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
      new Error("PostgreSQL response was lost after commit."),
    );
    let enqueueCallCount = 0;
    await assert.rejects(
      generateCardImageWithDependencies(
        createInput(new AbortController().signal),
        createPromotionEnqueueDependencies(async () => {
          enqueueCallCount += 1;
          if (enqueueCallCount === 1) {
            throw commitUnknownError;
          }
          return inconclusiveResult as EnqueueGeneratedMediaPromotionJobResult;
        }),
      ),
      (error: unknown) => error === commitUnknownError,
    );
    assert.equal(enqueueCallCount, 2);
  }
});

test("ambiguous enqueue preserves the original error when reconciliation throws", async () => {
  const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
    new Error("PostgreSQL response was lost after commit."),
  );
  const reconciliationError = new HttpError(
    503,
    "Generated media storage is temporarily unavailable.",
    "MEDIA_ASSET_STORAGE_UNAVAILABLE",
  );
  let enqueueCallCount = 0;

  await assert.rejects(
    generateCardImageWithDependencies(
      createInput(new AbortController().signal),
      createPromotionEnqueueDependencies(async () => {
        enqueueCallCount += 1;
        if (enqueueCallCount === 1) {
          throw commitUnknownError;
        }
        throw reconciliationError;
      }),
    ),
    (error: unknown) => error === commitUnknownError,
  );
  assert.equal(enqueueCallCount, 2);
});

test("deadline races preserve authoritative claim and commit errors", async () => {
  const authoritativeErrors = [
    new DatabaseCommitOutcomeUnknownError(
      new Error("PostgreSQL response was lost after commit."),
    ),
    new InactiveChatRunClaimError(runId),
  ];

  for (const authoritativeError of authoritativeErrors) {
    await assert.rejects(
      generateCardImageWithDependencies(
        {
          ...createInput(new AbortController().signal),
          operationDeadlineMs: Date.now() + 10,
        },
        createDelayedFailureDependencies(authoritativeError, 30),
      ),
      (error: unknown) => error === authoritativeError,
    );
  }
});

test("deadline abort does not replace unrelated dependency errors", async () => {
  const dependencyErrors = [
    new Error("Staging failed after the operation deadline fired."),
    new TransientDatabaseHttpError(
      new Error("Database connectivity failed after the operation deadline fired."),
    ),
  ];

  for (const dependencyError of dependencyErrors) {
    await assert.rejects(
      generateCardImageWithDependencies(
        {
          ...createInput(new AbortController().signal),
          operationDeadlineMs: Date.now() + 10,
        },
        createDelayedFailureDependencies(dependencyError, 30),
      ),
      (error: unknown) => error === dependencyError,
    );
  }
});

test("operation wrapper leaves caller cancellation arbitration to the tool layer", async () => {
  const cancellationController = new AbortController();
  const dependencyError = new DatabaseDeadlineExceededError(
    "executor_operations",
    Date.now() + 10,
    null,
  );
  const dependencies = createDelayedFailureDependencies(
    dependencyError,
    30,
  );
  setTimeout(() => cancellationController.abort(), 5);

  await assert.rejects(
    generateCardImageWithDependencies(
      {
        ...createInput(cancellationController.signal),
        operationDeadlineMs: Date.now() + 10,
      },
      dependencies,
    ),
    (error: unknown) => error === dependencyError,
  );
});

test("ambiguous enqueue remains authoritative when reconciliation reaches the deadline", async () => {
  const commitUnknownError = new DatabaseCommitOutcomeUnknownError(
    new Error("PostgreSQL response was lost after commit."),
  );
  let enqueueCallCount = 0;
  const input = {
    ...createInput(new AbortController().signal),
    operationDeadlineMs: Date.now() + 20,
  };
  const dependencies: GeneratedCardImageOperationDependencies = {
    assertPreconditionsFn: async () => undefined,
    withOperationLockFn: async (lockInput, callback) => callback(lockInput.signal),
    prepareStagedImageFn: async () => ({
      stagingStorageKey: "media/uploads/test",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      reused: false,
    }),
    enqueuePromotionJobFn: async () => {
      enqueueCallCount += 1;
      if (enqueueCallCount === 1) {
        throw commitUnknownError;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
      throw new DatabaseDeadlineExceededError(
        "executor_operations",
        input.operationDeadlineMs,
        null,
      );
    },
  };

  await assert.rejects(
    generateCardImageWithDependencies(input, dependencies),
    (error: unknown) => error === commitUnknownError,
  );
  assert.equal(enqueueCallCount, 2);
});
