const TRANSIENT_SQL_STATES = new Set<string>([
  "40001",
  "40P01",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "53300",
]);

const TRANSIENT_NETWORK_ERROR_CODES = new Set<string>([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "terminating connection due to administrator command",
  "connection terminated unexpectedly",
];

function isSqlStateCode(code: string): boolean {
  return code.length === 5 && /^[0-9A-Z]+$/.test(code) && !TRANSIENT_NETWORK_ERROR_CODES.has(code);
}

export function getDatabaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" && code !== "" ? code : null;
}

export function getDatabaseErrorSqlState(error: unknown): string | null {
  const code = getDatabaseErrorCode(error);
  if (code !== null && isSqlStateCode(code)) {
    return code;
  }

  return null;
}

export function getDatabaseErrorClass(error: unknown): string {
  if (error instanceof Error && error.constructor.name !== "") {
    return error.constructor.name;
  }

  return typeof error;
}

export function getDatabaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error);
  if (code !== null && (TRANSIENT_SQL_STATES.has(code) || TRANSIENT_NETWORK_ERROR_CODES.has(code))) {
    return true;
  }

  const normalizedMessage = getDatabaseErrorMessage(error).toLowerCase();
  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => normalizedMessage.includes(fragment));
}
