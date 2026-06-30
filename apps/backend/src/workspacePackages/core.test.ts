import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  parseWorkspacePackageCardsJsonV1,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
  toPortableWorkspacePackageCard,
  validatePortableMediaPath,
  validateUniquePortableMediaPaths,
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

test("Markdown fcasset helpers only read and rewrite inline link and image destinations", () => {
  const markdown = [
    "Plain fcasset:plain-asset stays plain.",
    "![diagram](fcasset:image-asset)",
    "[source](fcasset:link-asset)",
    "<img src=\"fcasset:html-asset\">",
    "[external](https://example.com/fcasset:not-internal)",
  ].join("\n");

  assert.deepEqual(extractMarkdownFcAssetIds(markdown), [
    "image-asset",
    "link-asset",
  ]);

  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map([
      ["image-asset", "media/image.png"],
      ["link-asset", "media/docs/source.txt"],
    ])),
    [
      "Plain fcasset:plain-asset stays plain.",
      "![diagram](media/image.png)",
      "[source](media/docs/source.txt)",
      "<img src=\"fcasset:html-asset\">",
      "[external](https://example.com/fcasset:not-internal)",
    ].join("\n"),
  );
});

test("Markdown media helpers skip fenced code blocks and inline code spans", () => {
  const markdown = [
    "`![inline code](fcasset:inline-code-image)`",
    "Text with `[inline code](fcasset:inline-code-link)` example.",
    "```markdown",
    "![fenced](fcasset:fenced-image)",
    "[fenced](media/fenced.txt)",
    "```",
    "![real](fcasset:real-image)",
    "[real](media/real.txt)",
  ].join("\n");

  assert.deepEqual(extractMarkdownFcAssetIds(markdown), ["real-image"]);

  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map([
      ["real-image", "media/real.png"],
    ])),
    [
      "`![inline code](fcasset:inline-code-image)`",
      "Text with `[inline code](fcasset:inline-code-link)` example.",
      "```markdown",
      "![fenced](fcasset:fenced-image)",
      "[fenced](media/fenced.txt)",
      "```",
      "![real](media/real.png)",
      "[real](media/real.txt)",
    ].join("\n"),
  );

  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map([
      ["media/real.txt", "real-link"],
    ])),
    [
      "`![inline code](fcasset:inline-code-image)`",
      "Text with `[inline code](fcasset:inline-code-link)` example.",
      "```markdown",
      "![fenced](fcasset:fenced-image)",
      "[fenced](media/fenced.txt)",
      "```",
      "![real](fcasset:real-image)",
      "[real](fcasset:real-link)",
    ].join("\n"),
  );
});

test("Markdown portable media helpers rewrite only package media destinations", () => {
  const markdown = [
    "media/plain.png is plain text.",
    "![diagram](media/image.png)",
    "[notes](media/docs/source.txt)",
    "[remote](https://example.com/media/image.png)",
  ].join("\n");

  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map([
      ["media/image.png", "image-asset"],
      ["media/docs/source.txt", "link-asset"],
    ])),
    [
      "media/plain.png is plain text.",
      "![diagram](fcasset:image-asset)",
      "[notes](fcasset:link-asset)",
      "[remote](https://example.com/media/image.png)",
    ].join("\n"),
  );
});

test("Markdown media helpers preserve link titles while rewriting destinations", () => {
  const markdown = [
    "![diagram](fcasset:image-asset \"Diagram title\")",
    "[notes](media/docs/source.txt 'Notes title')",
  ].join("\n");

  assert.deepEqual(extractMarkdownFcAssetIds(markdown), ["image-asset"]);

  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map([
      ["image-asset", "media/image.png"],
    ])),
    [
      "![diagram](media/image.png \"Diagram title\")",
      "[notes](media/docs/source.txt 'Notes title')",
    ].join("\n"),
  );

  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map([
      ["media/docs/source.txt", "notes-asset"],
    ])),
    [
      "![diagram](fcasset:image-asset \"Diagram title\")",
      "[notes](fcasset:notes-asset 'Notes title')",
    ].join("\n"),
  );
});

test("portable media path validation accepts relative media paths and rejects unsafe paths", () => {
  assert.equal(validatePortableMediaPath("media/image.png"), "media/image.png");
  assert.deepEqual(
    validateUniquePortableMediaPaths(["media/image.png", "media/docs/source.txt"]),
    ["media/image.png", "media/docs/source.txt"],
  );

  for (const invalidPath of [
    "",
    "image.png",
    "media",
    "media/",
    "media//image.png",
    "media/my image.png",
    "media/my(image).png",
    "media/my%20image.png",
    "media/image+.png",
    "media/../image.png",
    "media/%2e%2e/image.png",
    "/media/image.png",
    "https://example.com/media/image.png",
    "media\\image.png",
    "media/image.png?download=1",
    "media/image.png#fragment",
  ]) {
    assert.throws(() => validatePortableMediaPath(invalidPath), Error);
  }

  assert.throws(
    () => validateUniquePortableMediaPaths(["media/Image.png", "media/image.png"]),
    /duplicated/,
  );
});

test("portable media path validation rejects destinations the Markdown helper cannot round-trip", () => {
  for (const invalidPath of [
    "media/my image.png",
    "media/my(image).png",
    "media/my%20image.png",
  ]) {
    assert.throws(
      () => rewriteMarkdownFcAssetUrlsToPortablePathsFromMap("![image](fcasset:image-asset)", new Map([
        ["image-asset", invalidPath],
      ])),
      /Portable media path segments/,
    );
  }
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
