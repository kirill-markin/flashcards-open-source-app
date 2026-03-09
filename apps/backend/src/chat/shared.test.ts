import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Card, CardMutationMetadata, CreateCardInput, UpdateCardInput } from "../cards";
import { buildSystemInstructions, cardsApi, runCreateCardTool, runUpdateCardTool } from "./shared";

afterEach(() => {
  mock.restoreAll();
});

test("buildSystemInstructions keeps confirmation policy in the system prompt", () => {
  const instructions = buildSystemInstructions("Europe/Madrid");

  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
});

test("runCreateCardTool succeeds without confirmation text and normalizes input", async () => {
  const createCardMock = mock.method(cardsApi, "createCard", async (
    workspaceId: string,
    input: CreateCardInput,
    metadata: CardMutationMetadata,
  ): Promise<Card> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(input, {
      frontText: "Front",
      backText: "Back",
      tags: ["tag-a"],
      effortLevel: "medium",
    });
    assert.equal(metadata.lastModifiedByDeviceId, "device-1");
    assert.equal(typeof metadata.clientUpdatedAt, "string");
    assert.equal(typeof metadata.lastOperationId, "string");

    return {
      cardId: "card-1",
      frontText: input.frontText,
      backText: input.backText,
      tags: input.tags,
      effortLevel: input.effortLevel,
      dueAt: null,
      reps: 0,
      lapses: 0,
      fsrsCardState: "new",
      fsrsStepIndex: null,
      fsrsStability: null,
      fsrsDifficulty: null,
      fsrsLastReviewedAt: null,
      fsrsScheduledDays: null,
      clientUpdatedAt: metadata.clientUpdatedAt,
      lastModifiedByDeviceId: metadata.lastModifiedByDeviceId,
      lastOperationId: metadata.lastOperationId,
      updatedAt: metadata.clientUpdatedAt,
      deletedAt: null,
    };
  });

  const result = await runCreateCardTool(
    "workspace-1",
    {
      frontText: " Front ",
      backText: " Back ",
      tags: [" tag-a ", "", "tag-a"],
      effortLevel: "medium",
    },
    {
      deviceId: "device-1",
    },
  );

  assert.equal(createCardMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result).frontText, "Front");
});

test("runUpdateCardTool succeeds without confirmation text and trims provided fields", async () => {
  const updateCardMock = mock.method(cardsApi, "updateCard", async (
    workspaceId: string,
    cardId: string,
    input: UpdateCardInput,
    metadata: CardMutationMetadata,
  ): Promise<Card> => {
    assert.equal(workspaceId, "workspace-1");
    assert.equal(cardId, "card-1");
    assert.deepEqual(input, {
      frontText: "Updated front",
      tags: ["tag-b"],
    });
    assert.equal(metadata.lastModifiedByDeviceId, "device-1");

    return {
      cardId,
      frontText: input.frontText ?? "Front",
      backText: "Back",
      tags: input.tags ?? [],
      effortLevel: "medium",
      dueAt: null,
      reps: 0,
      lapses: 0,
      fsrsCardState: "new",
      fsrsStepIndex: null,
      fsrsStability: null,
      fsrsDifficulty: null,
      fsrsLastReviewedAt: null,
      fsrsScheduledDays: null,
      clientUpdatedAt: metadata.clientUpdatedAt,
      lastModifiedByDeviceId: metadata.lastModifiedByDeviceId,
      lastOperationId: metadata.lastOperationId,
      updatedAt: metadata.clientUpdatedAt,
      deletedAt: null,
    };
  });

  const result = await runUpdateCardTool(
    "workspace-1",
    "card-1",
    {
      frontText: " Updated front ",
      backText: undefined,
      tags: [" tag-b ", "", "tag-b"],
      effortLevel: undefined,
    },
    {
      deviceId: "device-1",
    },
  );

  assert.equal(updateCardMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result).cardId, "card-1");
});
