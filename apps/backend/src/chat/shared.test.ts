import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type {
  BulkCreateCardItem,
  BulkDeleteCardItem,
  BulkDeleteCardsResult,
  BulkUpdateCardItem,
  Card,
} from "../cards";
import type {
  BulkCreateDeckItem,
  BulkDeleteDeckItem,
  BulkDeleteDecksResult,
  BulkUpdateDeckItem,
  Deck,
} from "../decks";
import { ANTHROPIC_FLASHCARDS_TOOLS } from "./anthropic/tools";
import { OPENAI_FLASHCARDS_TOOLS } from "./openai/tools";
import {
  buildSystemInstructions,
  cardsApi,
  decksApi,
  runCreateCardsTool,
  runCreateDecksTool,
  runDeleteCardsTool,
  runDeleteDecksTool,
  runGetCardsTool,
  runGetDecksTool,
  runSearchDecksTool,
  runUpdateCardsTool,
  runUpdateDecksTool,
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

function createDeck(deckId: string, name: string, overrides?: Partial<Deck>): Deck {
  return {
    deckId,
    workspaceId: "workspace-1",
    name,
    filterDefinition: {
      version: 2,
      effortLevels: ["medium"],
      tags: [],
    },
    createdAt: "2026-03-10T10:00:00.000Z",
    clientUpdatedAt: "2026-03-10T10:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: `op-${deckId}`,
    updatedAt: "2026-03-10T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

test("buildSystemInstructions keeps delete confirmation policy in the system prompt", () => {
  const instructions = buildSystemInstructions("Europe/Madrid");

  assert.match(instructions, /wait for explicit user confirmation before executing the write tool/i);
  assert.match(instructions, /before any create, update, or delete tool call/i);
});

test("tool registrations expose the plural deck contract", () => {
  const openAiToolNames = OPENAI_FLASHCARDS_TOOLS.map((tool) => tool.name);
  const anthropicToolNames = ANTHROPIC_FLASHCARDS_TOOLS.map((tool) => tool.name);

  assert.deepEqual(openAiToolNames.filter((name) => name.includes("deck")), [
    "list_decks",
    "search_decks",
    "get_decks",
    "summarize_deck_state",
    "create_decks",
    "update_decks",
    "delete_decks",
  ]);
  assert.deepEqual(anthropicToolNames.filter((name) => name.includes("deck")), [
    "list_decks",
    "search_decks",
    "get_decks",
    "summarize_deck_state",
    "create_decks",
    "update_decks",
    "delete_decks",
  ]);
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

test("runGetDecksTool fetches decks by id in requested order", async () => {
  const getDecksMock = mock.method(decksApi, "getDecks", async (
    workspaceId: string,
    deckIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Deck>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(deckIds, ["deck-2", "deck-1"]);
    return [createDeck("deck-2", "Second"), createDeck("deck-1", "First")];
  });

  const result = await runGetDecksTool("workspace-1", ["deck-2", "deck-1"]);

  assert.equal(getDecksMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(result).map((deck: Deck) => deck.deckId), ["deck-2", "deck-1"]);
});

test("runSearchDecksTool searches deck names, tags, and effort levels", async () => {
  const searchDecksMock = mock.method(decksApi, "searchDecks", async (
    workspaceId: string,
    query: string,
    limit: number,
  ): Promise<ReadonlyArray<Deck>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.equal(query, "grammar");
    assert.equal(limit, 20);
    return [
      createDeck("deck-1", "Grammar", {
        filterDefinition: {
          version: 2,
          effortLevels: ["fast"],
          tags: ["grammar"],
        },
      }),
    ];
  });

  const result = await runSearchDecksTool("workspace-1", " grammar ", undefined);

  assert.equal(searchDecksMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result)[0].deckId, "deck-1");
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

test("runCreateDecksTool succeeds without confirmation text and normalizes input", async () => {
  const createDecksMock = mock.method(decksApi, "createDecks", async (
    workspaceId: string,
    items: ReadonlyArray<BulkCreateDeckItem>,
  ): Promise<ReadonlyArray<Deck>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]?.input, {
      name: "Grammar",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast", "medium"],
        tags: ["tag-a"],
      },
    });
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");

    return [createDeck("deck-1", "Grammar")];
  });

  const result = await runCreateDecksTool(
    "workspace-1",
    [{
      name: " Grammar ",
      effortLevels: ["fast", "medium", "fast"],
      tags: [" tag-a ", "", "tag-a"],
    }],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(createDecksMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result)[0].name, "Grammar");
});

test("runUpdateDecksTool resolves null-like unchanged fields against stored deck state", async () => {
  mock.method(decksApi, "getDecks", async (
    workspaceId: string,
    deckIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Deck>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(deckIds, ["deck-1"]);
    return [
      createDeck("deck-1", "Original", {
        filterDefinition: {
          version: 2,
          effortLevels: ["medium"],
          tags: ["tag-a"],
        },
      }),
    ];
  });
  const updateDecksMock = mock.method(decksApi, "updateDecks", async (
    workspaceId: string,
    items: ReadonlyArray<BulkUpdateDeckItem>,
  ): Promise<ReadonlyArray<Deck>> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(items[0], {
      deckId: "deck-1",
      input: {
        name: "Original",
        filterDefinition: {
          version: 2,
          effortLevels: ["fast"],
          tags: ["tag-b"],
        },
      },
      metadata: items[0]?.metadata,
    });
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");

    return [createDeck("deck-1", "Original")];
  });

  const result = await runUpdateDecksTool(
    "workspace-1",
    [{
      deckId: "deck-1",
      name: undefined,
      effortLevels: ["fast"],
      tags: [" tag-b ", "", "tag-b"],
    }],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(updateDecksMock.mock.callCount(), 1);
  assert.equal(JSON.parse(result)[0].deckId, "deck-1");
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

test("runDeleteDecksTool rejects duplicate deckIds", async () => {
  await assert.rejects(
    runDeleteDecksTool(
      "workspace-1",
      ["deck-1", "deck-1"],
      {
        deviceId: "device-1",
      },
    ),
    /duplicate deckId values/,
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

test("runDeleteDecksTool deletes decks in bulk", async () => {
  const deleteDecksMock = mock.method(decksApi, "deleteDecks", async (
    workspaceId: string,
    items: ReadonlyArray<BulkDeleteDeckItem>,
  ): Promise<BulkDeleteDecksResult> => {
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(items.map((item) => item.deckId), ["deck-1", "deck-2"]);
    assert.equal(items[0]?.metadata.lastModifiedByDeviceId, "device-1");

    return {
      deletedDeckIds: ["deck-1", "deck-2"],
      deletedCount: 2,
    };
  });

  const result = await runDeleteDecksTool(
    "workspace-1",
    ["deck-1", "deck-2"],
    {
      deviceId: "device-1",
    },
  );

  assert.equal(deleteDecksMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(result), {
    deletedDeckIds: ["deck-1", "deck-2"],
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

test("runCreateDecksTool rejects empty deck names after trimming", async () => {
  await assert.rejects(
    runCreateDecksTool(
      "workspace-1",
      [{
        name: "  ",
        effortLevels: ["fast"],
        tags: [],
      }],
      {
        deviceId: "device-1",
      },
    ),
    /name must not be empty/,
  );
});
