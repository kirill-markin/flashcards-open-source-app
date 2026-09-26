import type { EntitlementSnapshot, EntitlementStatus } from "../types/entitlement";
import { captureApiContractError } from "../observability/apiContractObservation";
import {
  ApiContractError,
  parseBoolean,
  parseEnum,
  parseNonNegativeInteger,
  parseObject,
  parseOptionalField,
  parseRequiredField,
  parseString,
  type JsonObject,
} from "./core";

function parseEntitlementStatus(value: unknown, endpoint: string, path: string): EntitlementStatus {
  return parseEnum(value, endpoint, path, ["none", "active", "in_grace"]);
}

function parseNullableLimit(value: unknown, endpoint: string, path: string): number | null {
  return value === null ? null : parseNonNegativeInteger(value, endpoint, path);
}

function parseUntil(value: unknown, endpoint: string, path: string): string | null {
  if (value === null) {
    return null;
  }
  const timestamp = parseString(value, endpoint, path);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) === false
    || Number.isFinite(Date.parse(timestamp)) === false) {
    throw new ApiContractError(endpoint, path, "ISO timestamp or null");
  }
  return timestamp;
}

function parseLimits(value: unknown, endpoint: string, path: string): EntitlementSnapshot["limits"] {
  const objectValue = parseObject(value, endpoint, path);
  return {
    aiMonthlyMessages: parseRequiredField(objectValue, "aiMonthlyMessages", endpoint, path, parseNullableLimit),
    aiMonthlyWeightedTokens: parseRequiredField(objectValue, "aiMonthlyWeightedTokens", endpoint, path, parseNullableLimit),
  };
}

export function parseEntitlementSnapshot(value: unknown, endpoint: string, path: string): EntitlementSnapshot {
  const objectValue = parseObject(value, endpoint, path);
  return {
    tier: parseRequiredField(objectValue, "tier", endpoint, path, parseString),
    tierRank: parseRequiredField(objectValue, "tierRank", endpoint, path, parseNonNegativeInteger),
    tierDisplayName: parseRequiredField(objectValue, "tierDisplayName", endpoint, path, parseString),
    status: parseRequiredField(objectValue, "status", endpoint, path, parseEntitlementStatus),
    until: parseRequiredField(objectValue, "until", endpoint, path, parseUntil),
    isTrial: parseRequiredField(objectValue, "isTrial", endpoint, path, parseBoolean),
    willRenew: parseRequiredField(objectValue, "willRenew", endpoint, path, parseBoolean),
    limits: parseRequiredField(objectValue, "limits", endpoint, path, parseLimits),
  };
}

export function parseOptionalEntitlement(objectValue: JsonObject, endpoint: string): EntitlementSnapshot | undefined {
  try {
    return parseOptionalField(objectValue, "entitlement", endpoint, "", parseEntitlementSnapshot);
  } catch (error) {
    // Billing data cannot prevent an otherwise valid sync or erase the last known access.
    if (error instanceof ApiContractError === false) {
      throw error;
    }
    console.error("Sync entitlement contract failed", { endpoint, fieldPath: error.fieldPath, expected: error.expected });
    captureApiContractError(error, {
      feature: "sync",
      sourceAction: "sync_pull_entitlement",
      userId: null,
      workspaceId: null,
      installationId: null,
    });
    return undefined;
  }
}
