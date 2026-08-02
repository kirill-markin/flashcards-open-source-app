import { extractMarkdownFcAssetIds } from "../workspacePackages";

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
