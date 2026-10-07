import type { AdminQueryRow, AdminQueryValue } from "../../adminApi";

// Readers for the rows the user page and event queries return, either positional JSON arrays or rows
// of named columns; `location` names the report and the row in every error.

export function readRowArray(value: AdminQueryValue | undefined, length: number, location: string): ReadonlyArray<AdminQueryValue> {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${location} must be an array of ${length} values.`);
  }
  return value;
}

function asNullableString(value: AdminQueryValue | undefined, fieldName: string, location: string): string | null {
  if (value === undefined || (value !== null && typeof value !== "string")) {
    throw new Error(`${location} field "${fieldName}" must be a string or null.`);
  }
  return value;
}

function asString(value: AdminQueryValue | undefined, fieldName: string, location: string): string {
  const stringValue = asNullableString(value, fieldName, location);
  if (stringValue === null) {
    throw new Error(`${location} field "${fieldName}" must not be null.`);
  }
  return stringValue;
}

function asNullableNumber(value: AdminQueryValue | undefined, fieldName: string, location: string): number | null {
  if (value === undefined || (value !== null && (typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error(`${location} field "${fieldName}" must be a finite number or null.`);
  }
  return value;
}

function asNumber(value: AdminQueryValue | undefined, fieldName: string, location: string): number {
  const numberValue = asNullableNumber(value, fieldName, location);
  if (numberValue === null) {
    throw new Error(`${location} field "${fieldName}" must not be null.`);
  }
  return numberValue;
}

function asNullableBoolean(value: AdminQueryValue | undefined, fieldName: string, location: string): boolean | null {
  if (value === undefined || (value !== null && typeof value !== "boolean")) {
    throw new Error(`${location} field "${fieldName}" must be a boolean or null.`);
  }
  return value;
}

function asBoolean(value: AdminQueryValue | undefined, fieldName: string, location: string): boolean {
  const booleanValue = asNullableBoolean(value, fieldName, location);
  if (booleanValue === null) {
    throw new Error(`${location} field "${fieldName}" must not be null.`);
  }
  return booleanValue;
}

export function readNullableString(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): string | null {
  return asNullableString(values[index], fieldName, location);
}

export function readString(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): string {
  return asString(values[index], fieldName, location);
}

export function readNullableNumber(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): number | null {
  return asNullableNumber(values[index], fieldName, location);
}

export function readNumber(values: ReadonlyArray<AdminQueryValue>, index: number, fieldName: string, location: string): number {
  return asNumber(values[index], fieldName, location);
}

export function readRowNullableString(row: AdminQueryRow, fieldName: string, location: string): string | null {
  return asNullableString(row[fieldName], fieldName, location);
}

export function readRowString(row: AdminQueryRow, fieldName: string, location: string): string {
  return asString(row[fieldName], fieldName, location);
}

export function readRowNumber(row: AdminQueryRow, fieldName: string, location: string): number {
  return asNumber(row[fieldName], fieldName, location);
}

export function readRowNullableNumber(row: AdminQueryRow, fieldName: string, location: string): number | null {
  return asNullableNumber(row[fieldName], fieldName, location);
}

export function readRowNullableBoolean(row: AdminQueryRow, fieldName: string, location: string): boolean | null {
  return asNullableBoolean(row[fieldName], fieldName, location);
}

export function readRowBoolean(row: AdminQueryRow, fieldName: string, location: string): boolean {
  return asBoolean(row[fieldName], fieldName, location);
}
