import { parseBrowserGuestCapabilities } from "./account";
import type { AiUsageAccountKind, AiUsageStatus, BrowserGuestAiTrialFeatureStatus, BrowserGuestAiTrialQuota, BrowserGuestAiTrialStatus } from "../types";
import {
  ApiContractError,
  parseBoolean,
  parseEnum,
  parseLiteral,
  parseNullableString,
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

function parseTrialDate(value: unknown, endpoint: string, path: string): string {
  const date = parseString(value, endpoint, path);
  if (Number.isFinite(Date.parse(date)) === false) throw new ApiContractError(endpoint, path, "ISO date");
  return date;
}

function parseTrialFeature(value: unknown, endpoint: string, path: string): BrowserGuestAiTrialFeatureStatus {
  const object = parseObject(value, endpoint, path);
  return {
    lifetimeLimit: parseRequiredField(object, "lifetimeLimit", endpoint, path, parseNonNegativeInteger),
    lifetimeRemaining: parseRequiredField(object, "lifetimeRemaining", endpoint, path, parseNonNegativeInteger),
    sharedDailyLimit: parseRequiredField(object, "sharedDailyLimit", endpoint, path, parseNonNegativeInteger),
    sharedAvailable: parseRequiredField(object, "sharedAvailable", endpoint, path, parseBoolean),
  };
}

function parseBrowserGuestAiTrial(value: unknown, endpoint: string, path: string): BrowserGuestAiTrialStatus | null {
  if (value === null) return null;
  const object = parseObject(value, endpoint, path);
  return {
    version: parseLiteral(object.version, endpoint, path + ".version", 1),
    enabled: parseRequiredField(object, "enabled", endpoint, path, parseBoolean),
    sharedResetsAt: parseRequiredField(object, "sharedResetsAt", endpoint, path, parseTrialDate),
    maxRecordingSeconds: parseLiteral(object.maxRecordingSeconds, endpoint, path + ".maxRecordingSeconds", 120),
    chat: parseRequiredField(object, "chat", endpoint, path, parseTrialFeature),
    dictation: parseRequiredField(object, "dictation", endpoint, path, parseTrialFeature),
    images: parseRequiredField(object, "images", endpoint, path, parseTrialFeature),
  };
}

export function parseBrowserGuestAiTrialQuota(value: unknown, endpoint: string): BrowserGuestAiTrialQuota {
  const details = parseObject(value, endpoint, "details");
  const path = "details.browserGuestAiTrial";
  const object = parseRequiredField(details, "browserGuestAiTrial", endpoint, "details", parseObject);
  const resetsAt = parseRequiredField(object, "resetsAt", endpoint, path, parseNullableString);
  return {
    feature: parseEnum(object.feature, endpoint, path + ".feature", ["chat", "dictation", "images"]),
    scope: parseEnum(object.scope, endpoint, path + ".scope", ["guest", "shared"]),
    resetsAt: resetsAt === null ? null : parseTrialDate(resetsAt, endpoint, path + ".resetsAt"),
  };
}

export function parseAiUsageStatusResponse(value: unknown, endpoint: string): AiUsageStatus {
  const objectValue = parseObject(value, endpoint, "");
  const usageValue = parseRequiredField(objectValue, "usage", endpoint, "", parseObject);

  return {
    browserGuestCapabilities: parseRequiredField(objectValue, "browserGuestCapabilities", endpoint, "", parseBrowserGuestCapabilities),
    browserGuestAiTrial: parseRequiredField(objectValue, "browserGuestAiTrial", endpoint, "", parseBrowserGuestAiTrial),
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
