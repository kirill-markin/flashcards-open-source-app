export function encodeCursor(value: Record<string, string | number | null>): string {
  return globalThis.btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const normalizedCursor = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const paddingLength = (4 - (normalizedCursor.length % 4)) % 4;
    const paddedCursor = `${normalizedCursor}${"=".repeat(paddingLength)}`;
    const parsedValue = JSON.parse(globalThis.atob(paddedCursor)) as unknown;

    if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
      throw new Error("cursor must decode to an object");
    }

    return parsedValue as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cursor is invalid: ${message}`);
  }
}
