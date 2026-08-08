import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownImageFcAssetIds,
  extractMarkdownLinkDestinationUrls,
  extractMarkdownNonCodeTextSegments,
  extractMarkdownPortableMediaPaths,
  rewriteMarkdownFcAssetUrlsToFcAssets,
  rewriteMarkdownFcAssetUrlsToPortablePaths,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownFcAssetUrlsToSharedPortablePaths,
  rewriteMarkdownPortableMediaUrlsToFcAssets,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
} from "../../workspacePackages";
import {
  rewriteMarkdownFcAssetUrlsToSharedPortablePathsFromMap,
} from "../../workspacePackages/markdownMedia";
import {
  assertMarkdownComplexityError,
  assertMarkdownMediaRoundTrip,
} from "./markdownTestSupport";

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
