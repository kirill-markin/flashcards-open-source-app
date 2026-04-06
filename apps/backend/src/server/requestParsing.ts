import { HttpError } from "../errors";

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export function expectNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

export function expectUuidString(value: unknown, fieldName: string): string {
  const trimmedValue = expectNonEmptyString(value, fieldName);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmedValue)) {
    throw new HttpError(400, `${fieldName} must be a UUID`);
  }

  return trimmedValue.toLowerCase();
}

export function expectNullableNonEmptyString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

export function expectBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
}

export function expectNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative integer`);
  }

  return value;
}

export function expectNullableNonNegativeInteger(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return expectNonNegativeInteger(value, fieldName);
}
