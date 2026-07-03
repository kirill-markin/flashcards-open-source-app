import type { ReviewPlatformSummary } from "../types";
import {
  parseBoolean,
  parseObject,
  parseRequiredField,
} from "./core";

export function parseReviewPlatformSummaryResponse(value: unknown, endpoint: string): ReviewPlatformSummary {
  const objectValue = parseObject(value, endpoint, "");

  return {
    hasMobileReviewEvent: parseRequiredField(objectValue, "hasMobileReviewEvent", endpoint, "", parseBoolean),
  };
}
