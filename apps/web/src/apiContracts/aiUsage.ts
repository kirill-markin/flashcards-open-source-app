import type { AiUsageAccountKind, AiUsageStatus } from "../types";
import {
  parseEnum,
  parseNonNegativeInteger,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";

const aiUsageAccountKinds: ReadonlyArray<AiUsageAccountKind> = ["account", "guest"];

function parseAiUsageAccountKind(value: unknown, endpoint: string, path: string): AiUsageAccountKind {
  return parseEnum(value, endpoint, path, aiUsageAccountKinds);
}

function parseNullableNonNegativeInteger(value: unknown, endpoint: string, path: string): number | null {
  if (value === null) {
    return null;
  }

  return parseNonNegativeInteger(value, endpoint, path);
}

export function parseAiUsageStatusResponse(value: unknown, endpoint: string): AiUsageStatus {
  const objectValue = parseObject(value, endpoint, "");
  const usageValue = parseRequiredField(objectValue, "usage", endpoint, "", parseObject);

  return {
    accountKind: parseRequiredField(objectValue, "accountKind", endpoint, "", parseAiUsageAccountKind),
    usage: {
      monthEndsAt: parseRequiredField(usageValue, "monthEndsAt", endpoint, "usage", parseString),
      remainingMessages: parseRequiredField(
        usageValue,
        "remainingMessages",
        endpoint,
        "usage",
        parseNullableNonNegativeInteger,
      ),
      ownKeyMessages: parseRequiredField(usageValue, "ownKeyMessages", endpoint, "usage", parseNonNegativeInteger),
    },
  };
}
