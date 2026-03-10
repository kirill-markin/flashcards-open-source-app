import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
} from "../cards";
import {
  buildSystemInstructions,
  cardsApi,
  runCreateCardsTool,
  runDeleteCardsTool,
  runGetCardsTool,
  runUpdateCardsTool,
} from "./shared";

afterEach(() => {
  mock.restoreAll();
});

function createCard(cardId: string, frontText: string): Card {
  return {
    cardId,
    frontText,
    backText: "",
    tags: [],
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
    clientUpdatedAt: "2026-03-10T10:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: `op-${cardId}`,
    updatedAt: "2026-03-10T10:00:00.000Z",
    deletedAt: null,
  };
}

test("buildSystemInstructions keeps delete confirmation policy in the system prompt", () => {
  const instructions = buildSystemInstructions("Europe/Madrid");

  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
  assert.match(instructions, /before any create, update, or delete tool call/i);
});

test("runGetCardsTool fetches cards by id in requested order", async () => {
  const getCardsMock = mock.method(cardsApi, "getCards", async (
    workspaceId: string,
    cardIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Card>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(cardIds, ["card-2", "card-1"]);
    return [createCard("card-2", "Second"), createCard("card-1", "First")];
  });

  const result = await runGetCardsTool("workspace-1", ["card-2", "card-1"]);

  assert.equal(getCardsMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(result).map((card: Card) => card.cardId), ["card-2", "card-1"]);
});

test("runCreateCardsTool succeeds without confirmation text and normalizes input", async () => {
  const createCardsMock = mock.method(cardsApi, "createCards", async (
    workspaceId: string,
    items: ReadonlyArray<BulkCreateCardItem>,
  ): Promise<ReadonlyArray<Card>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]?.input, {
      frontText: "Front",
      backText: "",
      tags: ["tag-a"],
      effortLevel: "medium",
    });
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");
    assert.equal(typeof items[0]?.metadata.clientUpdatedAt, "string");
    assert.equal(typeof items[0]?.metadata.lastOperationId, "string");

    return [createCard("card-1", "Front")];
  });

  const result = await runCreateCardsTool(
    "workspace-1",
    [{
      frontText: " Front ",
      backText: "   ",
      tags: [" tag-a ", "", "tag-a"],
      effortLevel: "medium",
    }],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(createCardsMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result)[0].frontText, "Front");
  assert.equal(JSON.parse(result)[0].backText, "");
});

test("runUpdateCardsTool succeeds without confirmation text and trims provided fields", async () => {
  const updateCardsMock = mock.method(cardsApi, "updateCards", async (
    workspaceId: string,
    items: ReadonlyArray<BulkUpdateCardItem>,
  ): Promise<ReadonlyArray<Card>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      cardId: "card-1",
      input: {
        frontText: "Updated front",
        backText: "",
        tags: ["tag-b"],
      },
      metadata: items[0]?.metadata,
    });
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");

    return [createCard("card-1", "Updated front")];
  });

  const result = await runUpdateCardsTool(
    "workspace-1",
    [{
      cardId: "card-1",
      frontText: " Updated front ",
      backText: "  ",
      tags: [" tag-b ", "", "tag-b"],
      effortLevel: undefined,
    }],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(updateCardsMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result)[0].cardId, "card-1");
});

test("runDeleteCardsTool rejects duplicate cardIds", async () => {
  await assert.rejects(
    runDeleteCardsTool(
      "workspace-1",
      ["card-1", "card-1"],
      {
        deviceId: "device-1",
      },
    ),
    /duplicate cardId values/,
  );
});

test("runDeleteCardsTool deletes cards in bulk", async () => {
  const deleteCardsMock = mock.method(cardsApi, "deleteCards", async (
    workspaceId: string,
    items: ReadonlyArray<BulkDeleteCardItem>,
  ): Promise<BulkDeleteCardsResult> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(items.map((item) => item.cardId), ["card-1", "card-2"]);
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");

    return {
      deletedCardIds: ["card-1", "card-2"],
      deletedCount: 2,
    };
  });

  const result = await runDeleteCardsTool(
    "workspace-1",
    ["card-1", "card-2"],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(deleteCardsMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(result), {
    deletedCardIds: ["card-1", "card-2"],
    deletedCount: 2,
  });
});

test("runCreateCardsTool rejects empty frontText after trimming", async () => {
  await assert.rejects(
    runCreateCardsTool(
      "workspace-1",
      [{
        frontText: "  ",
        backText: "",
        tags: [],
        effortLevel: "fast",
      }],
      {
        deviceId: "device-1",
      },
    ),
    /frontText must not be empty/,
  );
});
