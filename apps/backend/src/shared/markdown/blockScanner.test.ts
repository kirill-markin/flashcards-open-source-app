import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownImageFcAssetIds,
  extractMarkdownLinkDestinationUrls,
  extractMarkdownNonCodeTextSegments,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
} from "../../workspacePackages";
import {
  assertMarkdownMediaInactive,
  assertMarkdownMediaRoundTrip,
} from "./markdownTestSupport";

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
