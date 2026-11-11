import { ApiContractError, parseBoolean, parseNonNegativeInteger, parseObject, parseRequiredField, parseString } from "./core";

export type CardMaintenanceKind = "resetCard" | "resetDeck" | "resetTag" | "removeTag";

export type CardMaintenanceTarget = Readonly<{
  kind: CardMaintenanceKind;
  target: string;
}>;

export type CardMaintenanceExecution = CardMaintenanceTarget & Readonly<{
  confirmationText: string;
  previewFingerprint: string;
}>;

export type CardMaintenanceResult = Readonly<{
  affectedCardsCount: number;
}>;

export type CardMaintenancePreview = CardMaintenanceResult & Readonly<{
  targetName: string;
  confirmationText: string;
  previewFingerprint: string;
  includesAllCards: boolean;
  affectedDecksCount: number;
}>;

function parseNonEmptyString(value: unknown, endpoint: string, path: string): string {
  const result = parseString(value, endpoint, path);
  if (result.length === 0) {
    throw new ApiContractError(endpoint, path, "non-empty string");
  }

  return result;
}

export function parseCardMaintenancePreview(value: unknown, endpoint: string): CardMaintenancePreview {
  const path = "";
  const record = parseObject(value, endpoint, path);
  return {
    targetName: parseRequiredField(record, "targetName", endpoint, path, parseString),
    affectedCardsCount: parseRequiredField(record, "affectedCardsCount", endpoint, path, parseNonNegativeInteger),
    confirmationText: parseRequiredField(record, "confirmationText", endpoint, path, parseNonEmptyString),
    previewFingerprint: parseRequiredField(record, "previewFingerprint", endpoint, path, parseNonEmptyString),
    includesAllCards: parseRequiredField(record, "includesAllCards", endpoint, path, parseBoolean),
    affectedDecksCount: parseRequiredField(record, "affectedDecksCount", endpoint, path, parseNonNegativeInteger),
  };
}

export function parseCardMaintenanceResult(value: unknown, endpoint: string): CardMaintenanceResult {
  const path = "";
  const record = parseObject(value, endpoint, path);
  return {
    affectedCardsCount: parseRequiredField(record, "affectedCardsCount", endpoint, path, parseNonNegativeInteger),
  };
}

export function parseCardMaintenanceReconciliation(value: unknown, endpoint: string): boolean {
  return parseRequiredField(parseObject(value, endpoint, ""), "isSettled", endpoint, "", parseBoolean);
}
