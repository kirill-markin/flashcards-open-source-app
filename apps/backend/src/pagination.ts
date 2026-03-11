import { HttpError } from "./errors";

export type PaginationCursorValue = string | number | null;

export type DecodedPaginationCursor = Readonly<{
  values: ReadonlyArray<PaginationCursorValue>;
}>;

export type CursorPageInput = Readonly<{
  cursor: string | null;
  limit: number;
}>;

function createPaginationError(message: string): HttpError {
  return new HttpError(400, message);
}

export function encodeOpaqueCursor(values: ReadonlyArray<PaginationCursorValue>): string {
  return Buffer.from(JSON.stringify({ values }), "utf8").toString("base64url");
}

export function decodeOpaqueCursor(cursor: string, fieldName: string): DecodedPaginationCursor {
  try {
    const decodedValue = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof decodedValue !== "object" || decodedValue === null || Array.isArray(decodedValue)) {
      throw new Error("Cursor payload must be an object");
    }

    const recordValue = decodedValue as Record<string, unknown>;
    if (Array.isArray(recordValue.values) === false) {
      throw new Error("Cursor values must be an array");
    }

    const values = recordValue.values.map((value) => {
      if (typeof value === "string" || typeof value === "number" || value === null) {
        return value;
      }

      throw new Error("Cursor values must contain only strings, numbers, or null");
    });

    return { values };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw createPaginationError(`${fieldName} is invalid: ${errorMessage}`);
  }
}

export function parseRequiredPageLimit(value: string | undefined, fieldName: string, maximum: number): number {
  if (value === undefined) {
    throw createPaginationError(`${fieldName} is required`);
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isInteger(parsedValue) === false || parsedValue < 1 || parsedValue > maximum) {
    throw createPaginationError(`${fieldName} must be an integer between 1 and ${maximum}`);
  }

  return parsedValue;
}

export function parseOptionalCursorQuery(value: string | undefined, fieldName: string): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw createPaginationError(`${fieldName} must not be empty`);
  }

  return trimmedValue;
}
