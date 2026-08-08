import assert from "node:assert/strict";
import {
  extractMarkdownFcAssetIds,
  extractMarkdownImageFcAssetIds,
  extractMarkdownLinkDestinationUrls,
  rewriteMarkdownFcAssetUrlsToPortablePathsFromMap,
  rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap,
} from "../../workspacePackages";
import { HttpError } from "../errors";

export function assertMarkdownMediaRoundTrip(
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

export function assertMarkdownMediaInactive(markdown: string, assetId: string): void {
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

export function assertMarkdownComplexityError(
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
