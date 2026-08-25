// Not the `../workspacePackages` barrel: it pulls the image ingestion graph, which
// resolves `sharp` at load time, into every bundle reaching the public catalog snapshot.
import { extractMarkdownFcAssetIds } from "../workspacePackages/markdownMedia";

export type CatalogCardMediaReferenceInput = Readonly<{
  frontText: string;
  backText: string;
  mediaAssetKeys: ReadonlyArray<string>;
}>;

export function getCatalogCardRequiredPackageMediaKeys(
  input: CatalogCardMediaReferenceInput,
): ReadonlyArray<string> {
  return [...new Set([
    ...input.mediaAssetKeys,
    ...extractMarkdownFcAssetIds(input.frontText),
    ...extractMarkdownFcAssetIds(input.backText),
  ])];
}
