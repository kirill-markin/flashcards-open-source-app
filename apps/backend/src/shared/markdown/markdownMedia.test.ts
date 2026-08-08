import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownManagedMediaLifecycleReferences,
  extractMarkdownNonCodeTextSegments,
  parseManagedMediaLifecycleReference,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
  validatePortableMediaPath,
  validateUniquePortableMediaPaths,
} from "../../workspacePackages";
import { HttpError } from "../errors";
import { extractReferencedWorkspacePackageExportMediaAssetIds } from "../../workspacePackages/export/exportPreview";
import { extractReferencedWorkspacePackageMediaPaths } from "../../workspacePackages/import/importZip";
import { rewriteMarkdownImageDestinationUrl } from "../../workspacePackages/markdownMedia";
import { assertMarkdownComplexityError } from "./markdownTestSupport";

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
