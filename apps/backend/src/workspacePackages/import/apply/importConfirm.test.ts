import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import type { Card } from "../../../cards";
import {
  imageJpegCardMediaBlobMimeType,
  type MediaAsset,
} from "../../../mediaAssets/types";
import type { BackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import {
  confirmWorkspacePackageImportWithDependencies,
  type WorkspacePackageImportConfirmDependencies,
  type WorkspacePackageImportConfirmInput,
} from "./importConfirm";
import {
  planWorkspacePackageImport,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageCardsJsonV1,
  type WorkspacePackageImportCardPersistenceInput,
  type WorkspacePackageImportMediaAssetIngestionInput,
  type WorkspacePackageImportPlanInput,
  type WorkspacePackageImportReferencedMediaFile,
  type WorkspacePackageImportReferencedMediaInput,
} from "../../index";
import { validateWorkspacePackageImportPlanPreflight } from "../planning/importPlan";

const testUserId = "user-1";
const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testReplicaId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-06-30T12:00:00.000Z";
const clientUpdatedAt = "2026-06-30T12:01:00.000Z";
const importedAt = "2026-06-30T12:02:00.000Z";
const operationIdPrefix = "import-session-1";
const packageBytes = Buffer.from("zip bytes");

const observationScope: BackendObservationScope = {
  service: "backend-api",
  requestId: "request-1",
  route: null,
  method: null,
  userId: testUserId,
  workspaceId: testWorkspaceId,
  chatRequestId: null,
  runId: null,
  sessionId: null,
  clientAppVersion: null,
  clientPlatform: null,
};

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: null,
};

type ConfirmHarnessCalls = Readonly<{
  loadInputs: Array<WorkspacePackageImportReferencedMediaInput>;
  ingestInputs: Array<WorkspacePackageImportMediaAssetIngestionInput>;
  planInputs: Array<WorkspacePackageImportPlanInput>;
  persistInputs: Array<WorkspacePackageImportCardPersistenceInput>;
  order: Array<string>;
}>;

type ConfirmHarness = Readonly<{
  dependencies: WorkspacePackageImportConfirmDependencies;
  calls: ConfirmHarnessCalls;
}>;

function createPortableCard(
  frontText: string,
  backText: string,
): PortableWorkspacePackageCardV1 {
  return {
    frontText,
    backText,
    tags: ["biology", "legacy"],
    cardType: "basic",
    metadata: testMetadata,
  };
}

function createCardsJson(): WorkspacePackageCardsJsonV1 {
  return {
    formatVersion: 1,
    label: "Biology package",
    cards: [
      createPortableCard("Diagram: ![cell](media/images/cell.png)", "Answer"),
    ],
  };
}

function createMediaFile(
  portablePath: string,
  bytes: Buffer,
): WorkspacePackageImportReferencedMediaFile {
  return {
    portablePath,
    bytes,
    sizeBytes: bytes.byteLength,
  };
}

function createMediaAsset(mediaAssetId: string): MediaAsset {
  return {
    mediaAssetId,
    workspaceId: testWorkspaceId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: 12,
    sha256: `sha256-${mediaAssetId}`,
    sourceUrl: null,
    createdAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: `${operationIdPrefix}:media:0`,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

function createCard(cardId: string, input: WorkspacePackageImportCardPersistenceInput): Card {
  const plannedCard = input.plannedCards[0];
  if (plannedCard === undefined) {
    throw new Error("Missing planned card for test card creation.");
  }

  return {
    cardId,
    frontText: plannedCard.frontText,
    backText: plannedCard.backText,
    cardType: plannedCard.cardType,
    metadata: plannedCard.metadata,
    tags: plannedCard.tags,
    dueAt: null,
    createdAt: input.clientUpdatedAt,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: `${input.operationIdPrefix}:card:0`,
    updatedAt: input.clientUpdatedAt,
    deletedAt: null,
  };
}

function createConfirmInput(): WorkspacePackageImportConfirmInput {
  return {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    packageBytes,
    options: {
      addImportTag: true,
      importTag: "import:2026-06-30-0",
      removeTags: ["legacy"],
      importedAt,
      importId: operationIdPrefix,
    },
    createdAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    operationIdPrefix,
    observationScope,
  };
}

function createConfirmHarness(cardsJson: WorkspacePackageCardsJsonV1): ConfirmHarness {
  const mediaFile = createMediaFile("media/images/cell.png", Buffer.from("image bytes"));
  const mediaAsset = createMediaAsset("asset-1");
  const loadInputs: Array<WorkspacePackageImportReferencedMediaInput> = [];
  const ingestInputs: Array<WorkspacePackageImportMediaAssetIngestionInput> = [];
  const planInputs: Array<WorkspacePackageImportPlanInput> = [];
  const persistInputs: Array<WorkspacePackageImportCardPersistenceInput> = [];
  const order: Array<string> = [];

  return {
    calls: {
      loadInputs,
      ingestInputs,
      planInputs,
      persistInputs,
      order,
    },
    dependencies: {
      loadReferencedMediaFn: async (input) => {
        order.push("load");
        loadInputs.push(input);
        return {
          cardsJson,
          referencedMediaFiles: [mediaFile],
          referencedMediaFilesByPath: new Map([
            [mediaFile.portablePath, mediaFile],
          ]),
        };
      },
      ingestMediaAssetsFn: async (input) => {
        order.push("ingest");
        ingestInputs.push(input);
        return {
          mediaAssets: [
            {
              portablePath: mediaFile.portablePath,
              mediaAsset,
              applied: true,
            },
          ],
          mediaAssetIdsByPortablePath: new Map([
            [mediaFile.portablePath, mediaAsset.mediaAssetId],
          ]),
        };
      },
      assertReplicaBelongsToWorkspaceFn: async (userId, workspaceId, replicaId) => {
        order.push("replica");
        assert.equal(userId, testUserId);
        assert.equal(workspaceId, testWorkspaceId);
        assert.equal(replicaId, testReplicaId);
      },
      validatePlanPreflightFn: (input) => {
        order.push("preflight");
        validateWorkspacePackageImportPlanPreflight(input);
      },
      planImportFn: (input) => {
        order.push("plan");
        planInputs.push(input);
        return planWorkspacePackageImport(input);
      },
      persistCardsFn: async (input) => {
        order.push("persist");
        persistInputs.push(input);
        return {
          cards: [createCard("card-1", input)],
          summary: {
            cardCount: input.plannedCards.length,
            batchCount: 1,
          },
        };
      },
    },
  };
}

test("workspace package import confirmation orchestrates media load, ingestion, planning, and persistence", async () => {
  const cardsJson = createCardsJson();
  const harness = createConfirmHarness(cardsJson);
  const input = createConfirmInput();

  const result = await confirmWorkspacePackageImportWithDependencies(input, harness.dependencies);

  assert.deepEqual(harness.calls.order, ["replica", "load", "preflight", "ingest", "plan", "persist"]);
  assert.deepEqual(harness.calls.loadInputs, [{ packageBytes }]);
  assert.equal(harness.calls.ingestInputs.length, 1);
  const ingestInput = harness.calls.ingestInputs[0];
  assert.ok(ingestInput !== undefined);
  assert.deepEqual(ingestInput, {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    referencedMediaFiles: ingestInput.referencedMediaFiles,
    createdAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    operationIdPrefix,
    observationScope,
  });
  assert.deepEqual(
    ingestInput.referencedMediaFiles.map((mediaFile) => mediaFile.portablePath),
    ["media/images/cell.png"],
  );
  assert.equal(harness.calls.planInputs[0]?.cardsJson, cardsJson);
  assert.deepEqual(harness.calls.planInputs[0]?.options, input.options);
  assert.equal(harness.calls.planInputs[0]?.mediaAssetIdsByPortablePath.get("media/images/cell.png"), "asset-1");
  assert.equal(harness.calls.persistInputs.length, 1);
  assert.deepEqual(harness.calls.persistInputs[0]?.plannedCards[0]?.tags, ["biology", "import:2026-06-30-0"]);
  assert.equal(harness.calls.persistInputs[0]?.plannedCards[0]?.frontText, "Diagram: ![cell](fcasset:asset-1)");
  assert.deepEqual(result.cards.map((card) => card.cardId), ["card-1"]);
  assert.deepEqual(result.importedMediaAssets.map((mediaAsset) => mediaAsset.mediaAsset.mediaAssetId), ["asset-1"]);
  assert.deepEqual(result.summary, {
    cardCount: 1,
    cardBatchCount: 1,
    referencedMediaCount: 1,
    importedMediaAssetCount: 1,
    appliedMediaAssetCount: 1,
    keptTagCount: 1,
    removedTagCount: 1,
    importTag: "import:2026-06-30-0",
  });
});

test("workspace package import confirmation lets persistence failures surface without rollback masking", async () => {
  const harness = createConfirmHarness(createCardsJson());
  const expectedError = new Error("card persistence failed");
  const dependencies: WorkspacePackageImportConfirmDependencies = {
    ...harness.dependencies,
    persistCardsFn: async (input) => {
      harness.calls.order.push("persist");
      harness.calls.persistInputs.push(input);
      throw expectedError;
    },
  };

  await assert.rejects(
    () => confirmWorkspacePackageImportWithDependencies(createConfirmInput(), dependencies),
    (error: unknown): boolean => error === expectedError,
  );
  assert.deepEqual(harness.calls.order, ["replica", "load", "preflight", "ingest", "plan", "persist"]);
  assert.equal(harness.calls.persistInputs.length, 1);
});

test("workspace package import confirmation rejects wrong workspace replica before media ingestion", async () => {
  const harness = createConfirmHarness(createCardsJson());
  const expectedError = new HttpError(
    400,
    "lastModifiedByReplicaId must reference a workspace replica for this workspace.",
    "WORKSPACE_PACKAGE_IMPORT_REPLICA_INVALID",
  );
  const dependencies: WorkspacePackageImportConfirmDependencies = {
    ...harness.dependencies,
    assertReplicaBelongsToWorkspaceFn: async () => {
      harness.calls.order.push("replica");
      throw expectedError;
    },
    loadReferencedMediaFn: async (input) => {
      harness.calls.order.push("load");
      harness.calls.loadInputs.push(input);
      throw new Error("ZIP import media loader must not be called when replica ownership is invalid.");
    },
    ingestMediaAssetsFn: async (input) => {
      harness.calls.order.push("ingest");
      harness.calls.ingestInputs.push(input);
      throw new Error("Media ingestion must not be called when replica ownership is invalid.");
    },
    persistCardsFn: async (input) => {
      harness.calls.order.push("persist");
      harness.calls.persistInputs.push(input);
      throw new Error("Card persistence must not be called when replica ownership is invalid.");
    },
  };

  await assert.rejects(
    () => confirmWorkspacePackageImportWithDependencies(createConfirmInput(), dependencies),
    (error: unknown): boolean => error === expectedError,
  );
  assert.deepEqual(harness.calls.order, ["replica"]);
  assert.equal(harness.calls.ingestInputs.length, 0);
  assert.equal(harness.calls.persistInputs.length, 0);
});

test("workspace package import confirmation validates semantic options before media ingestion", async () => {
  const harness = createConfirmHarness(createCardsJson());
  const baseInput = createConfirmInput();
  const input: WorkspacePackageImportConfirmInput = {
    ...baseInput,
    options: {
      ...baseInput.options,
      removeTags: ["unknown-tag"],
    },
  };

  await assert.rejects(
    () => confirmWorkspacePackageImportWithDependencies(input, harness.dependencies),
    (error: unknown): boolean => (
      error instanceof HttpError
      && error.statusCode === 400
      && error.code === "WORKSPACE_PACKAGE_IMPORT_INPUT_INVALID"
      && /unknown-tag/.test(error.message)
    ),
  );
  assert.deepEqual(harness.calls.order, ["replica", "load", "preflight"]);
  assert.equal(harness.calls.ingestInputs.length, 0);
  assert.equal(harness.calls.persistInputs.length, 0);
});
