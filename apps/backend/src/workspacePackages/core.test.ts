import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownLinkDestinationUrls,
  extractMarkdownNonCodeTextSegments,
  extractMarkdownPortableMediaPaths,
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

function assertMarkdownMediaRoundTrip(
  markdown: string,
  mappings: ReadonlyArray<readonly [string, string]>,
): void {
  const portableMarkdown = mappings.reduce((rewrittenMarkdown, [assetId, portablePath]) => (
    rewrittenMarkdown.replaceAll(`fcasset:${assetId}`, portablePath)
  ), markdown);
  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map(mappings)),
    portableMarkdown,
  );
  const assetIdsByPortablePath = new Map(
    mappings.map(([assetId, portablePath]) => [portablePath, assetId]),
  );
  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(portableMarkdown, assetIdsByPortablePath),
    markdown,
  );
}

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

test("Markdown media helpers stream code, links, and escape precedence", () => {
  const cases: ReadonlyArray<readonly [
    string, ReadonlyArray<readonly [string, string]>, ReadonlyArray<string> | null,
  ]> = [
    ["`[exact](fcasset:exact)` [active](fcasset:active)", [["active", "media/active.png"]], null],
    ["`[longer-run](fcasset:longer-run)``", [["longer-run", "media/longer-run.png"]], null],
    [
      `${String.raw`\[escaped-label](fcasset:escaped-label)`}\n${String.raw`\\[even-label](fcasset:even-label)`}`,
      [["even-label", "media/even-label.png"]],
      null,
    ],
    ["\\``[odd-backtick](fcasset:odd-backtick)`", [["odd-backtick", "media/odd-backtick.png"]], null],
    [
      `${String.raw`\![escaped-image](fcasset:escaped-image)`}\n${String.raw`\\![even-image](fcasset:even-image)`}`,
      [["escaped-image", "media/escaped-image.png"], ["even-image", "media/even-image.png"]],
      null,
    ],
    [
      "~~~markdown\r\n[fenced](fcasset:fenced)\r\n~~~\r\n[active](fcasset:active)",
      [["active", "media/active.png"]],
      null,
    ],
    ["before `code` middle\n~~~\nfenced\n~~~\nafter", [], ["before ", " middle\n", "after"]],
    [
      "![label `code ](fcasset:hidden)` tail](fcasset:label)\n"
        + "[title](fcasset:title \"raw ` title\") [next](fcasset:next) `prose`",
      [["label", "media/label.png"], ["title", "media/title.png"], ["next", "media/next.png"]],
      ["![label ", " tail](fcasset:label)\n[title](fcasset:title \"raw ` title\") [next](fcasset:next) "],
    ],
    [
      "[label `code ](fcasset:hidden) \"title\"`\n[active](fcasset:active)",
      [["active", "media/active.png"]],
      ["[label ", "\n[active](fcasset:active)"],
    ],
    [
      "\\``[odd-backtick](fcasset:odd-backtick)`",
      [["odd-backtick", "media/odd-backtick.png"]],
      ["\\``[odd-backtick](fcasset:odd-backtick)"],
    ],
    ["\\\\``[even-backtick](fcasset:even-backtick)``", [], ["\\\\"]],
  ];

  for (const [markdown, mappings, nonCodeText] of cases) {
    assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
    assertMarkdownMediaRoundTrip(markdown, mappings);
    if (nonCodeText !== null) {
      assert.deepEqual(extractMarkdownNonCodeTextSegments(markdown), nonCodeText);
    }
  }
});

test("Markdown media helpers classify container fences and list continuations once", () => {
  const cases: ReadonlyArray<readonly [
    string, ReadonlyArray<readonly [string, string]>, ReadonlyArray<string> | null,
  ]> = [
    ["before\r\n~~~\r\n[hidden](fcasset:hidden)\r\n[portable](media/hidden.png)\r\n~~~\r\nafter",
      [], ["before\r\n", "after"]],
    ["~~~\n[hidden](fcasset:hidden)\n~~~ extra\n[still hidden](media/hidden.png)\n~~~~\n[active](fcasset:active)",
      [["active", "media/active.png"]], null],
    ["> - ~~~\n>\n>   [hidden](fcasset:hidden)\n>   [portable](media/hidden.png)\n>   ~~~\n[active](fcasset:active)",
      [["active", "media/active.png"]], null],
    ["10. item\n    ~~~\n    [hidden](fcasset:hidden)\n    [portable](media/hidden.png)\n    ~~~\n[active](fcasset:active)",
      [["active", "media/active.png"]], ["10. item\n", "[active](fcasset:active)"]],
    [["paragraph", "14. ~~~", "    [active](fcasset:active)", "    ~~~"].join("\n"),
      [["active", "media/active.png"]], null],
    ["> \t~~~\r\n>   [hidden](fcasset:hidden)\r\n>   [portable](media/hidden.png)\r\n>   ~~~\r\n-\t ~~~\r\n     [hidden](fcasset:hidden)\r\n     [portable](media/hidden.png)\r\n     ~~~\r\n[active](fcasset:active)",
      [["active", "media/active.png"]], null],
    ["-     \n  ~~~\n  [hidden](fcasset:hidden)\n  [portable](media/hidden.png)\n  ~~~\n[active](fcasset:active)",
      [["active", "media/active.png"]], null],
    [["-", "", "    ~~~", "    [active](fcasset:active)", "    ~~~"].join("\n"),
      [["active", "media/active.png"]], null],
  ];

  for (const [markdown, mappings, nonCodeText] of cases) {
    assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
    assertMarkdownMediaRoundTrip(markdown, mappings);
    if (nonCodeText !== null) {
      assert.deepEqual(extractMarkdownNonCodeTextSegments(markdown), nonCodeText);
    }
  }

  const nestedListDepth = 128;
  const nestedListMarkdown = `${"- ".repeat(nestedListDepth)}item\n${
    "  ".repeat(nestedListDepth)}[active](fcasset:active)`;
  assert.deepEqual(extractMarkdownFcAssetIds(nestedListMarkdown), ["active"]);
  assertMarkdownMediaRoundTrip(nestedListMarkdown, [["active", "media/active.png"]]);
});

test("Markdown media helpers keep inline code inside real block and HTML boundaries", () => {
  const activeCases = [
    "`open\n# heading\n` [active](fcasset:active)",
    "`open\n---\n` [active](fcasset:active)",
    "`open\n~~~\n[hidden](fcasset:hidden)\n~~~\n` [active](fcasset:active)",
    "`open\n<div>\n[hidden](fcasset:hidden)\n\n` [active](fcasset:active)",
    "> `open\n> ---\n> ` [active](fcasset:active)",
    "> `code [hidden](fcasset:hidden)\ncontinuation\n===\n` [active](fcasset:active)",
    "<pre>\n[hidden](fcasset:hidden)\n</script>\n~~~\n[fenced](media/hidden.png)\n~~~\n[active](fcasset:active)",
    ...["<x a:b=ok flag quoted=\"<>\">", "</x >"].map((htmlTag) => (
      `${htmlTag}\n[hidden](fcasset:hidden)\n\n[active](fcasset:active)`)),
    ...["</x garbage>", "<x ???>"].map((htmlTag) => (
      `${htmlTag}\n~~~\n[hidden](fcasset:hidden)\n[portable](media/hidden.png)\n~~~\n[active](fcasset:active)`)),
    ...([
      ["<!--", "-->"], ["<?", "?>"], ["<!DECLARATION", ">"],
      ["<![CDATA[", "]]>"], ["<table>", ""],
    ] as const).map(([htmlStart, htmlEnd]) => (
      `${htmlStart}\n[hidden](fcasset:hidden)\n${htmlEnd}\n\n[active](fcasset:active)`)),
  ];
  for (const markdown of activeCases) {
    assert.deepEqual(extractMarkdownFcAssetIds(markdown), ["active"]);
    assertMarkdownMediaRoundTrip(markdown, [["active", "media/active.png"]]);
  }

  for (const malformedTag of ["</x garbage>", "<x ???>"]) {
    const markdown = `${malformedTag}\n~~~\n[hidden](fcasset:hidden)\n~~~\n[active](fcasset:active)`;
    assert.deepEqual(extractMarkdownNonCodeTextSegments(markdown),
      [`${malformedTag}\n`, "[active](fcasset:active)"]);
  }
});

test("Markdown non-code text keeps raw HTML for public safety checks", () => {
  const unsafeHtmlReference = "media/blobs/sha256/aa/aa/html-private";
  const markdown = [
    "<div>",
    unsafeHtmlReference,
    "`raw HTML backticks`",
    "</div>",
    "",
    "visible `inline media/blobs/sha256/aa/aa/inline-private` after",
    "~~~",
    "media/blobs/sha256/aa/aa/fenced-private",
    "~~~",
    "tail",
  ].join("\n");

  assert.deepEqual(extractMarkdownNonCodeTextSegments(markdown), [
    ["<div>", unsafeHtmlReference, "`raw HTML backticks`", "</div>", "", "visible "].join("\n"),
    " after\n",
    "tail",
  ]);
});

test("Markdown media helpers preserve code and events from invalid one-line links", () => {
  const multilineCode = "[literal `\n[x](fcasset:x)\n`";
  const multilinePortableCode = multilineCode.replace("fcasset:x", "media/x.png");
  assert.deepEqual(extractMarkdownFcAssetIds(multilineCode), []);
  assert.deepEqual(extractMarkdownNonCodeTextSegments(multilineCode), ["[literal "]);
  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(multilineCode, new Map([["x", "media/x.png"]])),
    multilineCode,
  );
  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(
      multilinePortableCode, new Map([["media/x.png", "x"]]),
    ),
    multilinePortableCode,
  );

  const malformedSuffix = "[broken](dest \"before [active](fcasset:active) after\" nope";
  assert.deepEqual(extractMarkdownFcAssetIds(malformedSuffix), ["active"]);
  assertMarkdownMediaRoundTrip(malformedSuffix, [["active", "media/active.png"]]);
  assert.deepEqual(extractMarkdownNonCodeTextSegments(
    "[broken](dest \"before `hidden` after\" nope",
  ), ["[broken](dest \"before ", " after\" nope"]);
});

test("Markdown media helpers preserve current one-line destination grammar", () => {
  const markdown = [
    "![angle](<fcasset:angle>)",
    "[single](fcasset:single 'single title')",
    "[double](fcasset:double \"raw ` title\")",
    "[portable](media/original.png)",
    "[longer](fcasset:longer!)",
    "[malformed](fcasset:malformed \"unterminated)",
    "<span>[html](fcasset:html)</span>",
    "Plain fcasset:plain remains prose.",
  ].join("\n");

  assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), [
    "fcasset:angle",
    "fcasset:single",
    "fcasset:double",
    "media/original.png",
    "fcasset:longer!",
    "fcasset:html",
  ]);
  assert.deepEqual(extractMarkdownFcAssetIds(markdown), [
    "angle",
    "single",
    "double",
    "html",
  ]);
  assert.deepEqual(extractMarkdownPortableMediaPaths(markdown), ["media/original.png"]);
  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map([
      ["angle", "media/angle.png"],
      ["single", "media/single.png"],
      ["double", "media/double.png"],
      ["html", "media/html.png"],
    ])),
    markdown
      .replace("fcasset:angle", "media/angle.png")
      .replace("fcasset:single", "media/single.png")
      .replace("fcasset:double", "media/double.png")
      .replace("fcasset:html", "media/html.png"),
  );
  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map([
      ["media/original.png", "original"],
    ])),
    markdown.replace("media/original.png", "fcasset:original"),
  );
});

test("Markdown media helpers advance through marker-heavy malformed input", () => {
  const markdown = [
    "![broken](".repeat(5_000),
    `${"[](x".repeat(5_000)} q`,
    "[active](fcasset:active)",
  ].join("\n");

  assert.deepEqual(extractMarkdownFcAssetIds(markdown), ["active"]);
  assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), ["fcasset:active"]);
  assertMarkdownMediaRoundTrip(markdown, [["active", "media/active.png"]]);

  const deferredCodeOnly = `a \` ${"``x`` ".repeat(5_000)}`;
  assert.deepEqual(extractMarkdownLinkDestinationUrls(deferredCodeOnly), []);

  const matchedDestinationHeavyCode = `\`${"[](x)".repeat(5_000)}\``;
  assert.deepEqual(extractMarkdownLinkDestinationUrls(matchedDestinationHeavyCode), []);
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
