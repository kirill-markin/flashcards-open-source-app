import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkspacePackageCardsJsonV1,
  toPortableWorkspacePackageCard,
} from "./index";
import type { WorkspacePackageCardMetadataV1 } from "./index";

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: {
    label: "Starter deck",
    author: null,
    comment: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    importedAt: null,
    importId: null,
  },
};

test("toPortableWorkspacePackageCard projects only portable card fields", () => {
  const card = {
    cardId: "backend-card-id",
    frontText: "What is the prompt?",
    backText: "The answer.",
    tags: ["core", "portable"],
    cardType: "basic",
    metadata: testMetadata,
    dueAt: "2026-06-02T12:00:00.000Z",
    reps: 12,
    lapses: 1,
    fsrsCardState: "review",
    lastOperationId: "operation-1",
    updatedAt: "2026-06-02T12:00:00.000Z",
  };

  assert.deepEqual(toPortableWorkspacePackageCard(card), {
    frontText: "What is the prompt?",
    backText: "The answer.",
    tags: ["core", "portable"],
    cardType: "basic",
    metadata: testMetadata,
  });
});

test("workspace package cards.json parser normalizes card source metadata", () => {
  const parsedPackage = parseWorkspacePackageCardsJsonV1({
    formatVersion: 1,
    label: "Starter",
    extraPackageField: "ignored",
    cards: [
      {
        frontText: " Prompt ",
        backText: " Answer ",
        tags: [" tag "],
        cardType: " ",
        metadata: {
          version: 1,
          source: {
            label: "Source label",
            importId: "import-1",
            extraSourceField: "ignored",
          },
        },
        dueAt: "must not leak",
      },
      {
        frontText: "Second prompt",
        backText: "Second answer",
        tags: [" custom "],
        cardType: " custom-type ",
        metadata: {
          version: 1,
          source: null,
        },
      },
    ],
  });

  assert.deepEqual(parsedPackage, {
    formatVersion: 1,
    label: "Starter",
    cards: [
      {
        frontText: "Prompt",
        backText: "Answer",
        tags: ["tag"],
        cardType: "basic",
        metadata: {
          version: 1,
          source: {
            label: "Source label",
            author: null,
            comment: null,
            createdAt: null,
            importedAt: null,
            importId: "import-1",
          },
        },
      },
      {
        frontText: "Second prompt",
        backText: "Second answer",
        tags: ["custom"],
        cardType: "custom-type",
        metadata: {
          version: 1,
          source: null,
        },
      },
    ],
  });
});

test("workspace package cards.json parser rejects empty normalized card fields", () => {
  const baseCard = {
    frontText: "Prompt",
    backText: "Answer",
    tags: ["tag"],
    cardType: "basic",
    metadata: {
      version: 1,
      source: null,
    },
  };

  assert.throws(
    () => parseWorkspacePackageCardsJsonV1({
      formatVersion: 1,
      cards: [
        {
          ...baseCard,
          frontText: " ",
        },
      ],
    }),
    /Invalid workspace package cards\.json/,
  );

  assert.throws(
    () => parseWorkspacePackageCardsJsonV1({
      formatVersion: 1,
      cards: [
        {
          ...baseCard,
          tags: ["tag", " "],
        },
      ],
    }),
    /Invalid workspace package cards\.json/,
  );
});
