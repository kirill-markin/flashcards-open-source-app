import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownImageFcAssetIds,
  extractMarkdownLinkDestinationUrls,
  extractMarkdownManagedMediaLifecycleReferences,
  extractMarkdownNonCodeTextSegments,
  extractMarkdownPortableMediaPaths,
  parseManagedMediaLifecycleReference,
  parseWorkspacePackageCardsJsonV1,
  rewriteMarkdownFcAssetUrlsToFcAssets,
  rewriteMarkdownFcAssetUrlsToPortablePaths,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownFcAssetUrlsToSharedPortablePaths,
  rewriteMarkdownPortableMediaUrlsToFcAssets,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
  toPortableWorkspacePackageCard,
  validatePortableMediaPath,
  validateUniquePortableMediaPaths,
} from "./index";
import type { WorkspacePackageCardMetadataV1 } from "./index";
import { HttpError } from "../shared/errors";
import { extractReferencedWorkspacePackageExportMediaAssetIds } from "./export/exportPreview";
import { extractReferencedWorkspacePackageMediaPaths } from "./import/importZip";
import {
  rewriteMarkdownFcAssetUrlsToSharedPortablePathsFromMap,
  rewriteMarkdownImageDestinationUrl,
} from "./markdownMedia";

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

function assertMarkdownMediaInactive(markdown: string, assetId: string): void {
  const portablePath = `media/${assetId}.png`;
  const portableMarkdown = markdown.replaceAll(`fcasset:${assetId}`, portablePath);
  assert.deepEqual(extractMarkdownFcAssetIds(markdown), []);
  assert.deepEqual(extractMarkdownImageFcAssetIds(markdown), []);
  assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), []);
  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(
      markdown,
      new Map([[assetId, portablePath]]),
    ),
    markdown,
  );
  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(
      portableMarkdown,
      new Map([[portablePath, assetId]]),
    ),
    portableMarkdown,
  );
}

function assertMarkdownComplexityError(
  operation: () => void,
  sourceIndex: number,
  expectedCode: string,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, expectedCode);
    assert.match(error.message, new RegExp(`source index ${sourceIndex}`));
    assert.match(error.message, /maximumDepth=1000/);
    assert.match(error.message, /Simplify nested Markdown labels and retry/);
    return true;
  });
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

test("Markdown image destination replacement preserves links and code examples", () => {
  const pendingUrl = "fcasset:11111111-1111-4111-8111-111111111111?state=pending";
  const readyUrl = "fcasset:11111111-1111-4111-8111-111111111111";
  const markdown = [
    `\`![inline code](${pendingUrl})\``,
    "```markdown",
    `![fenced code](${pendingUrl})`,
    "```",
    `[source link](${pendingUrl})`,
    `![active image](${pendingUrl})`,
  ].join("\n");

  assert.equal(
    rewriteMarkdownImageDestinationUrl(markdown, pendingUrl, readyUrl),
    [
      `\`![inline code](${pendingUrl})\``,
      "```markdown",
      `![fenced code](${pendingUrl})`,
      "```",
      `[source link](${pendingUrl})`,
      `![active image](${readyUrl})`,
    ].join("\n"),
  );
});

test("managed media lifecycle references are typed and block non-ready package exports", () => {
  const mediaAssetId = "11111111-1111-4111-8111-111111111111";
  const readyUrl = `fcasset:${mediaAssetId}`;
  const pendingUrl = `${readyUrl}?state=pending`;
  const failedUrl = `${readyUrl}?state=failed`;
  const markdown = [
    `![ready](${readyUrl})`,
    `![pending](${pendingUrl})`,
    `[failed source](${failedUrl})`,
    `\`![literal](${pendingUrl})\``,
  ].join("\n");

  assert.deepEqual(parseManagedMediaLifecycleReference(readyUrl), {
    mediaAssetId,
    state: "ready",
    destination: readyUrl,
  });
  assert.deepEqual(
    extractMarkdownManagedMediaLifecycleReferences(markdown),
    [
      { mediaAssetId, state: "ready", destination: readyUrl, isImage: true },
      { mediaAssetId, state: "pending", destination: pendingUrl, isImage: true },
      { mediaAssetId, state: "failed", destination: failedUrl, isImage: false },
    ],
  );
  assert.throws(
    () => extractReferencedWorkspacePackageExportMediaAssetIds([{
      card_id: "card-1",
      front_text: markdown,
      back_text: "Answer",
      card_type: "basic",
      metadata: null,
      tags: [],
    }]),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "WORKSPACE_PACKAGE_EXPORT_MANAGED_MEDIA_NOT_READY"
      && error.message.includes(pendingUrl)
      && error.message.includes(failedUrl)
      && error.message.includes("retry after promotion and attachment settle")
      && error.message.includes("Failed managed media is terminal")
      && error.message.includes("remove the reference or regenerate and reattach the image"),
  );

  const unsupportedUrls = [
    `FCASSET:${mediaAssetId}`,
    `FCASSET:${mediaAssetId}?state=pending`,
    `FcAsSeT:${mediaAssetId}?state=failed`,
    `${readyUrl}?state=ready`,
    `${readyUrl}?state`,
    `${readyUrl}?state=`,
    `${readyUrl}?state=unknown`,
    `${readyUrl}?state=pending&state=failed`,
    `${readyUrl}?v=1`,
    `${readyUrl}?state=pending&v=1`,
    `${readyUrl}#preview`,
    `${readyUrl}?state=failed#preview`,
    `${readyUrl}?state=pending&amp;v=1`,
  ];
  for (const unsupportedUrl of unsupportedUrls) {
    assert.equal(parseManagedMediaLifecycleReference(unsupportedUrl), null);
    assert.throws(
      () => extractReferencedWorkspacePackageExportMediaAssetIds([{
        card_id: "card-1",
        front_text: `![unsupported](${unsupportedUrl})`,
        back_text: "Answer",
        card_type: "basic",
        metadata: null,
        tags: [],
      }]),
      (error: unknown) => error instanceof HttpError
        && error.statusCode === 409
        && error.code === "WORKSPACE_PACKAGE_EXPORT_MANAGED_MEDIA_NOT_READY"
        && error.message.includes("Unsupported managed media lifecycle URLs")
        && error.message.includes(unsupportedUrl),
    );
  }
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

test("Markdown media helpers share one ordered single-line active destination contract", () => {
  const markdown = [
    "![image](fcasset:image)",
    "[link](fcasset:link)",
    String.raw`[escaped \] label](fcasset:escaped)`,
    "[balanced [label]](fcasset:balanced)",
    "[code `]` label](fcasset:code)",
    "![portable image](media/image.png)",
    "[portable link](media/link.txt)",
    "![duplicate](fcasset:image)",
  ].join(" ");
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["image", "media/image-fcasset.png"],
    ["link", "media/link-fcasset.txt"],
    ["escaped", "media/escaped.png"],
    ["balanced", "media/balanced.png"],
    ["code", "media/code.png"],
  ];

  assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), [
    "fcasset:image",
    "fcasset:link",
    "fcasset:escaped",
    "fcasset:balanced",
    "fcasset:code",
    "media/image.png",
    "media/link.txt",
    "fcasset:image",
  ]);
  assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
  assert.deepEqual(extractMarkdownImageFcAssetIds(markdown), ["image"]);
  assert.deepEqual(extractMarkdownPortableMediaPaths(markdown), [
    "media/image.png",
    "media/link.txt",
  ]);
  assert.equal(
    rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map(mappings)),
    mappings.reduce((rewrittenMarkdown, [assetId, portablePath]) => (
      rewrittenMarkdown.replaceAll(`fcasset:${assetId}`, portablePath)
    ), markdown),
  );
  assert.equal(
    rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map([
      ["media/image.png", "portable-image"],
      ["media/link.txt", "portable-link"],
    ])),
    markdown
      .replace("media/image.png", "fcasset:portable-image")
      .replace("media/link.txt", "fcasset:portable-link"),
  );
});

test("Markdown media helpers preserve nested identity and resume invalid outer tails", () => {
  const markdown = [
    "[outer [inner](fcasset:inner)](fcasset:inactive-outer)",
    "[outer [empty]()](fcasset:inactive-empty-outer)",
    "[outer [empty-angle](<>)](fcasset:inactive-empty-angle-outer)",
    "[![image](fcasset:primary)](fcasset:source)",
    "![description [reference](fcasset:reference)](fcasset:description-image)",
    "[outer [nested](fcasset:nested-link)](![tail](fcasset:tail))",
    "[outer ![description [isolated](fcasset:image-reference)](fcasset:container-image)]"
      + "(fcasset:outer-source)",
  ].join(" ");
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["inner", "media/inner.png"],
    ["primary", "media/image.png"],
    ["source", "media/source.png"],
    ["reference", "media/reference.png"],
    ["description-image", "media/description-image.png"],
    ["nested-link", "media/nested.png"],
    ["tail", "media/tail.png"],
    ["image-reference", "media/isolated.png"],
    ["container-image", "media/nested-image.png"],
    ["outer-source", "media/isolated-outer.png"],
  ];

  assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
  assert.deepEqual(extractMarkdownImageFcAssetIds(markdown), [
    "primary",
    "description-image",
    "tail",
    "container-image",
  ]);
  assertMarkdownMediaRoundTrip(markdown, mappings);
});

test("Markdown media helpers parse exact one-line destinations and titles", () => {
  const markdown = [
    "[title-looking]( \"title\")",
    "[parenthesized-destination]( (target))",
    "[empty]()",
    "[angle-empty](<>)",
    "![angle](<fcasset:angle> \"angle title\")",
    "[double](fcasset:double \"double title\")",
    "[single](fcasset:single 'single title')",
    String.raw`[parenthesized-title](fcasset:parenthesized (escaped \(title\)))`,
    "[balanced-destination](https://example.com/a(b)c)",
    String.raw`[escaped-bare](https://example.com/a\))`,
    String.raw`[escaped-angle](<https://example.com/a\>>)`,
    "[invalid-parenthesized-title](fcasset:inactive-open (bad(open))",
    "[adjacent-titles](fcasset:inactive-adjacent \"one\" \"two\")",
    "[unterminated-title](fcasset:inactive-unterminated \"title)",
  ].join(" ");
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["angle", "media/angle.png"],
    ["double", "media/double.png"],
    ["single", "media/single.png"],
    ["parenthesized", "media/parenthesized.png"],
  ];

  assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), [
    "\"title\"",
    "(target)",
    "fcasset:angle",
    "fcasset:double",
    "fcasset:single",
    "fcasset:parenthesized",
    "https://example.com/a(b)c",
    String.raw`https://example.com/a\)`,
    String.raw`https://example.com/a\>`,
  ]);
  assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
  assert.deepEqual(extractMarkdownImageFcAssetIds(markdown), ["angle"]);
  assertMarkdownMediaRoundTrip(markdown, mappings);
});

test("Markdown media helpers continue labels through valid logical lines", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["![soft\nbreak](fcasset:soft)", "soft"],
    ["![hard  \nbreak](fcasset:hard-spaces)", "hard-spaces"],
    [String.raw`![hard\
break](fcasset:hard-backslash)`, "hard-backslash"],
    ["![crlf\r\nbreak](fcasset:crlf)", "crlf"],
    ["![ordered\n14. continuation](fcasset:ordered)", "ordered"],
    ["![indented\n    continuation](fcasset:indented)", "indented"],
    ["> ![explicit\n> continuation](fcasset:explicit)", "explicit"],
    ["> ![lazy\ncontinuation](fcasset:lazy)", "lazy"],
    ["> ![html\n<span data-x=value>\ncontinuation](fcasset:type-seven)", "type-seven"],
    ["![invalid fence\n```bad` info\ncontinuation](fcasset:invalid-fence)", "invalid-fence"],
    [String.raw`![escaped \]
[balanced] label](fcasset:balanced)`, "balanced"],
    ["![code `raw\n] label`](fcasset:code)", "code"],
  ];

  for (const [markdown, assetId] of cases) {
    assert.deepEqual(extractMarkdownFcAssetIds(markdown), [assetId]);
    assert.deepEqual(extractMarkdownImageFcAssetIds(markdown), [assetId]);
    assert.deepEqual(extractMarkdownLinkDestinationUrls(markdown), [`fcasset:${assetId}`]);
    assertMarkdownMediaRoundTrip(markdown, [[assetId, `media/${assetId}.png`]]);
  }

  const linkMarkdown = "[multiline\nlink](fcasset:link)";
  assert.deepEqual(extractMarkdownFcAssetIds(linkMarkdown), ["link"]);
  assert.deepEqual(extractMarkdownImageFcAssetIds(linkMarkdown), []);
  assertMarkdownMediaRoundTrip(linkMarkdown, [["link", "media/link.png"]]);
});

test("Markdown media helpers stop labels at structural boundaries", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["![blank\n\n tail](fcasset:blank)", "blank"],
    ["![heading\n# heading\n tail](fcasset:heading)", "heading"],
    ["![bullet\n- item\n tail](fcasset:bullet)", "bullet"],
    ["![thematic\n---\n tail](fcasset:thematic)", "thematic"],
    ["![blockquote\n> quote\n tail](fcasset:blockquote)", "blockquote"],
    ["![fence\n```\n tail](fcasset:fence)", "fence"],
    ["![html\n<div>\n tail](fcasset:html)", "html"],
    ["> ![blank marker\n-\n tail](fcasset:blank-marker)", "blank-marker"],
    ["> ![ordered exit\n2. item\n tail](fcasset:ordered-exit)", "ordered-exit"],
    ["> ![container blank\n>\n> tail](fcasset:container-blank)", "container-blank"],
    ["> ![lf\n-\n tail](fcasset:lf-exit)", "lf-exit"],
    ["> ![crlf\r\n-\r\n tail](fcasset:crlf-exit)", "crlf-exit"],
    ["&gt; ![entity\n-\n tail](fcasset:entity-exit)", "entity-exit"],
    ["&gt; ![entity\r\n-\r\n tail](fcasset:entity-crlf-exit)", "entity-crlf-exit"],
  ];

  for (const [markdown, assetId] of cases) {
    assertMarkdownMediaInactive(markdown, assetId);
  }
});

test("Markdown media helpers parse multiline components and quoted inline HTML exactly", () => {
  const markdown = [
    "![opening](\nfcasset:opening)",
    "![double](fcasset:double\n\"title\")",
    "![single](fcasset:single 'first\nsecond')",
    "![parenthesized](fcasset:parenthesized (first\r\nsecond))",
    "> ![quoted](fcasset:quoted\r\n> \"title\")",
  ].join("\n\n");
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["opening", "media/opening.png"],
    ["double", "media/double.png"],
    ["single", "media/single.png"],
    ["parenthesized", "media/parenthesized.png"],
    ["quoted", "media/quoted.png"],
  ];
  assert.deepEqual(extractMarkdownFcAssetIds(markdown), mappings.map(([assetId]) => assetId));
  assert.deepEqual(
    extractMarkdownImageFcAssetIds(markdown),
    mappings.map(([assetId]) => assetId),
  );
  assertMarkdownMediaRoundTrip(markdown, mappings);

  for (const [inactiveMarkdown, assetId] of [
    ["![double break](\n\nfcasset:double-break)", "double-break"],
    ["![blank title](fcasset:blank-title \"first\n\nsecond\")", "blank-title"],
    ["![heading title](fcasset:heading-title \"first\n# heading\nsecond\")", "heading-title"],
    ["> ![marker blank](fcasset:marker-blank\n>\n> \"title\")", "marker-blank"],
  ] as const) {
    assertMarkdownMediaInactive(inactiveMarkdown, assetId);
  }

  const quotedHtml = "![foo <bar attr=\"\n](fcasset:inner)\">](fcasset:outer)";
  assert.deepEqual(extractMarkdownFcAssetIds(quotedHtml), ["outer"]);
  assert.deepEqual(extractMarkdownImageFcAssetIds(quotedHtml), ["outer"]);
  assertMarkdownMediaRoundTrip(quotedHtml, [["outer", "media/outer.png"]]);

  const malformedHtml = "![foo <bar attr=\"\n](fcasset:inner)>](fcasset:outer)";
  assert.deepEqual(extractMarkdownFcAssetIds(malformedHtml), ["inner"]);
  assert.deepEqual(extractMarkdownImageFcAssetIds(malformedHtml), ["inner"]);
  assertMarkdownMediaRoundTrip(malformedHtml, [["inner", "media/inner.png"]]);

  const opaqueAutolinks = [
    "![before",
    "<https://example.com/[hidden](fcasset:hidden-uri)>",
    "<foo`bar@example.com>",
    "after](fcasset:visible)",
  ].join("\n");
  assert.deepEqual(extractMarkdownFcAssetIds(opaqueAutolinks), ["visible"]);
  assert.deepEqual(extractMarkdownImageFcAssetIds(opaqueAutolinks), ["visible"]);
  assertMarkdownMediaRoundTrip(opaqueAutolinks, [["visible", "media/visible.png"]]);
});

test("Markdown media helpers reject unbalanced bare destinations before line endings", () => {
  for (const lineEnding of ["\n", "\r\n"]) {
    const directMarkdown = `![direct](foo(${lineEnding})`;
    assert.deepEqual(extractMarkdownLinkDestinationUrls(directMarkdown), []);
    assert.deepEqual(extractMarkdownFcAssetIds(directMarkdown), []);
    assert.deepEqual(extractMarkdownImageFcAssetIds(directMarkdown), []);
    assert.equal(
      rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(directMarkdown, new Map()),
      directMarkdown,
    );
    assert.equal(
      rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(directMarkdown, new Map()),
      directMarkdown,
    );

    const nestedLink = `[outer [inner](foo(${lineEnding})](fcasset:outer)`;
    assert.deepEqual(extractMarkdownLinkDestinationUrls(nestedLink), ["fcasset:outer"]);
    assert.deepEqual(extractMarkdownFcAssetIds(nestedLink), ["outer"]);
    assert.deepEqual(extractMarkdownImageFcAssetIds(nestedLink), []);
    assertMarkdownMediaRoundTrip(nestedLink, [["outer", "media/outer.png"]]);

    const nestedImage = `![outer [inner](foo(${lineEnding})](fcasset:image)`;
    assert.deepEqual(extractMarkdownLinkDestinationUrls(nestedImage), ["fcasset:image"]);
    assert.deepEqual(extractMarkdownFcAssetIds(nestedImage), ["image"]);
    assert.deepEqual(extractMarkdownImageFcAssetIds(nestedImage), ["image"]);
    assertMarkdownMediaRoundTrip(nestedImage, [["image", "media/image.png"]]);

    const validMarkdown = [
      `![balanced](https://example.com/a(b)${lineEnding}"title")`,
      `![escaped](https://example.com/a\\(${lineEnding}'title')`,
      `![angle](<https://example.com/a(b)>${lineEnding}(title))`,
    ].join(" ");
    assert.deepEqual(extractMarkdownLinkDestinationUrls(validMarkdown), [
      "https://example.com/a(b)",
      String.raw`https://example.com/a\(`,
      "https://example.com/a(b)",
    ]);
  }
});

test("Markdown media helpers treat valid one-line HTML and autolinks as opaque", () => {
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["visible-tag", "media/visible-tag.png"],
    ["visible-comment", "media/visible-comment.png"],
    ["visible-processing", "media/visible-processing.png"],
    ["visible-declaration", "media/visible-declaration.png"],
    ["visible-cdata", "media/visible-cdata.png"],
    ["visible-uri", "media/visible-uri.png"],
    ["visible-email", "media/visible-email.png"],
    ["visible-control", "media/visible-control.png"],
  ];
  const markdown = [
    "before <x data-x=\"[hidden-tag](fcasset:hidden-tag)\" quoted='`' bare=value flag>"
      + "[visible tag](fcasset:visible-tag)</x >",
    "before <!-- [hidden-comment](fcasset:hidden-comment) ` -->"
      + " [visible comment](fcasset:visible-comment)",
    "before <? [hidden-processing](fcasset:hidden-processing) ` ?>"
      + " [visible processing](fcasset:visible-processing)",
    "before <!DOCTYPE [hidden-declaration](fcasset:hidden-declaration) `>"
      + " [visible declaration](fcasset:visible-declaration)",
    "before <![CDATA[[hidden-cdata](fcasset:hidden-cdata) `]]>"
      + " [visible cdata](fcasset:visible-cdata)",
    "before <https://example.com/[hidden-uri](fcasset:hidden-uri)?tick=`>"
      + " [visible uri](fcasset:visible-uri)",
    "before <foo`bar@example.com> [visible email](fcasset:visible-email)",
    "before <x data-x=foo\u000b[hidden-control](fcasset:hidden-control)>"
      + " [visible control](fcasset:visible-control)",
  ].join("\n");

  assert.deepEqual(
    extractMarkdownFcAssetIds(markdown),
    mappings.map(([assetId]) => assetId),
  );
  assert.deepEqual(
    extractMarkdownLinkDestinationUrls(markdown),
    mappings.map(([assetId]) => `fcasset:${assetId}`),
  );
  assert.deepEqual(extractMarkdownNonCodeTextSegments(markdown), [markdown]);
  assertMarkdownMediaRoundTrip(markdown, mappings);

  const deeplyNestedOpaqueAttribute = `before <x data-x="${"[".repeat(1_001)}"> after`;
  assert.deepEqual(extractMarkdownFcAssetIds(deeplyNestedOpaqueAttribute), []);
});

test("Markdown media helpers keep malformed and escaped one-line spans visible", () => {
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["unclosed-quote", "media/unclosed-quote.png"],
    ["bad-attribute", "media/bad-attribute.png"],
    ["unclosed-comment", "media/unclosed-comment.png"],
    ["invalid-uri", "media/invalid-uri.png"],
    ["escaped-tag", "media/escaped-tag.png"],
    ["carriage-return", "media/carriage-return.png"],
    ["delete-control", "media/delete-control.png"],
    ["vertical-tab", "media/vertical-tab.png"],
    ["nonbreaking-space", "media/nonbreaking-space.png"],
  ];
  const markdown = [
    "before <x data-x=\"[unclosed quote](fcasset:unclosed-quote)>",
    "before <x ??? [bad attribute](fcasset:bad-attribute)>",
    "before <!-- [unclosed comment](fcasset:unclosed-comment)",
    "before <x:[invalid uri](fcasset:invalid-uri)>",
    String.raw`before \<x data-x="[escaped tag](fcasset:escaped-tag)">`,
    "before <x data-x=\"\r[carriage return](fcasset:carriage-return)\">",
    "before <ab:\u007f[delete control](fcasset:delete-control)>",
    "before <x\u000ba=\"[vertical tab](fcasset:vertical-tab)\">",
    "before <x\u00a0a=\"[nonbreaking space](fcasset:nonbreaking-space)\">",
  ].join("\n");

  assert.deepEqual(
    extractMarkdownFcAssetIds(markdown),
    mappings.map(([assetId]) => assetId),
  );
  assertMarkdownMediaRoundTrip(markdown, mappings);
});

test("Markdown helpers enforce one stable bounded label complexity contract", () => {
  const acceptedMarkdown = "[".repeat(1_000);
  const shallowMarkerHeavyMarkdown = "[]".repeat(1_001);
  const failedDestinationMarkdown = `${"[".repeat(1_000)}](abc] x[[`;
  const failedDestinationBeforeOpaqueMarkdown =
    `[label](abc <x data-x="${"[".repeat(1_001)}">`;
  const carriageReturnMarkdown = `${"[".repeat(1_000)}\r${"[".repeat(1_000)}`;
  const completedLinkBeforeLineBoundaryMarkdown =
    `${"[".repeat(999)}[x](url)\n\n${"[".repeat(1_000)}`;
  const multilineCodeAfterCompletedLabelMarkdown =
    `${"[".repeat(1_000)}]\`\n\n\`[[`;
  const rejectedMarkdown = "[".repeat(1_001);
  const unreachableResolver = (): string => {
    throw new Error("Resolver must not be called for incomplete labels.");
  };
  const scannerOperations: ReadonlyArray<readonly [string, (markdown: string) => void]> = [
    ["fcasset extraction", (markdown) => { extractMarkdownFcAssetIds(markdown); }],
    ["image fcasset extraction", (markdown) => { extractMarkdownImageFcAssetIds(markdown); }],
    ["destination extraction", (markdown) => { extractMarkdownLinkDestinationUrls(markdown); }],
    ["non-code extraction", (markdown) => { extractMarkdownNonCodeTextSegments(markdown); }],
    ["portable extraction", (markdown) => { extractMarkdownPortableMediaPaths(markdown); }],
    ["portable rewrite", (markdown) => {
      rewriteMarkdownFcAssetUrlsToPortablePaths(markdown, unreachableResolver);
    }],
    ["portable map rewrite", (markdown) => {
      rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(markdown, new Map());
    }],
    ["shared portable rewrite", (markdown) => {
      rewriteMarkdownFcAssetUrlsToSharedPortablePaths(markdown, unreachableResolver);
    }],
    ["shared portable map rewrite", (markdown) => {
      rewriteMarkdownFcAssetUrlsToSharedPortablePathsFromMap(markdown, new Map());
    }],
    ["fcasset rewrite", (markdown) => {
      rewriteMarkdownFcAssetUrlsToFcAssets(markdown, unreachableResolver);
    }],
    ["portable fcasset rewrite", (markdown) => {
      rewriteMarkdownPortableMediaUrlsToFcAssets(markdown, unreachableResolver);
    }],
    ["portable fcasset map rewrite", (markdown) => {
      rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(markdown, new Map());
    }],
  ];

  for (const [operationName, operation] of scannerOperations) {
    assert.doesNotThrow(
      () => operation(acceptedMarkdown),
      `${operationName} must accept depth 1,000`,
    );
    assert.doesNotThrow(
      () => operation(shallowMarkerHeavyMarkdown),
      `${operationName} must limit nested depth rather than total labels`,
    );
    assert.doesNotThrow(
      () => operation(failedDestinationMarkdown),
      `${operationName} must account for brackets skipped by failed destinations`,
    );
    assert.doesNotThrow(
      () => operation(failedDestinationBeforeOpaqueMarkdown),
      `${operationName} must re-enter at opaque spans after failed destinations`,
    );
    assert.doesNotThrow(
      () => operation(carriageReturnMarkdown),
      `${operationName} must reset label depth after a lone carriage return`,
    );
    assert.doesNotThrow(
      () => operation(completedLinkBeforeLineBoundaryMarkdown),
      `${operationName} must reset unresolved outer labels after a paragraph boundary`,
    );
    assert.doesNotThrow(
      () => operation(multilineCodeAfterCompletedLabelMarkdown),
      `${operationName} must not restore label depth across a code paragraph boundary`,
    );
    assertMarkdownComplexityError(
      () => operation(rejectedMarkdown),
      1_000,
      "MARKDOWN_COMPLEXITY_LIMIT_EXCEEDED",
    );
  }

  const resolverError = new TypeError("Resolver failed independently.");
  assert.throws(
    () => rewriteMarkdownFcAssetUrlsToPortablePaths(
      "[image](fcasset:image)",
      () => {
        throw resolverError;
      },
    ),
    (error: unknown) => error === resolverError,
  );
});

test("Markdown complexity errors preserve export and import consumer contracts", () => {
  const rejectedMarkdown = "[".repeat(1_001);
  assertMarkdownComplexityError(
    () => {
      extractReferencedWorkspacePackageExportMediaAssetIds([{
        card_id: "card-1",
        front_text: rejectedMarkdown,
        back_text: "Answer",
        card_type: "basic",
        metadata: null,
        tags: [],
      }]);
    },
    1_000,
    "MARKDOWN_COMPLEXITY_LIMIT_EXCEEDED",
  );

  assertMarkdownComplexityError(
    () => {
      extractReferencedWorkspacePackageMediaPaths([{
        frontText: rejectedMarkdown,
        backText: "Answer",
        tags: [],
        cardType: "basic",
        metadata: { version: 1, source: null },
      }]);
    },
    1_000,
    "WORKSPACE_PACKAGE_IMPORT_PREVIEW_CARDS_JSON_INVALID",
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
