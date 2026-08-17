import { defaultUrlTransform } from "react-markdown";
import { parseManagedMediaAssetId } from "../../../../media/managedMediaMarkdown";

export { ManagedMediaReference } from "./managedMedia/ManagedMediaReference";
export {
  parseManagedMediaAssetId,
  parseManagedMediaUrlReference,
} from "../../../../media/managedMediaMarkdown";

export function reviewMarkdownUrlTransform(url: string): string {
  return parseManagedMediaAssetId(url) === null ? defaultUrlTransform(url) : url;
}
