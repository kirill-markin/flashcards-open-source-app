export type LegacyEffortLevel = "fast" | "medium" | "long";

export function isLegacyEffortLevel(value: unknown): value is LegacyEffortLevel {
  return value === "fast" || value === "medium" || value === "long";
}
