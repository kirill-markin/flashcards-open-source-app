import type { AdminQueryValue } from "../../adminApi";

// Readers for the positional JSON arrays the Chats and Cards queries return; `location` names the
// report and the row in every error.

export function readRowArray(value: AdminQueryValue | undefined, length: number, location: string): ReadonlyArray<AdminQueryValue> {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${location} must be an array of ${length} values.`);
  }
  return value;
}

export function readNullableString(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): string | null {
  const value = values[index];
  if (value === undefined || (value !== null && typeof value !== "string")) {
    throw new Error(`${location} field "${fieldName}" must be a string or null.`);
  }
  return value;
}

export function readString(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): string {
  const value = readNullableString(values, index, fieldName, location);
  if (value === null) {
    throw new Error(`${location} field "${fieldName}" must not be null.`);
  }
  return value;
}

export function readNullableNumber(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): number | null {
  const value = values[index];
  if (value === undefined || (value !== null && (typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error(`${location} field "${fieldName}" must be a finite number or null.`);
  }
  return value;
}

export function readNumber(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): number {
  const value = readNullableNumber(values, index, fieldName, location);
  if (value === null) {
    throw new Error(`${location} field "${fieldName}" must not be null.`);
  }
  return value;
}
