export type JsonObject = Readonly<Record<string, unknown>>;
export type LiteralValue = string | number | boolean | null;
export type ValueParser<ParsedValue> = (value: unknown, endpoint: string, path: string) => ParsedValue;

export class ApiContractError extends Error {
  readonly endpoint: string;
  readonly fieldPath: string;
  readonly expected: string;

  constructor(endpoint: string, fieldPath: string, expected: string) {
    super(`Invalid API response for ${endpoint}: ${fieldPath} must be ${expected}`);
    this.name = "ApiContractError";
    this.endpoint = endpoint;
    this.fieldPath = fieldPath;
    this.expected = expected;
  }
}

export function joinPath(parentPath: string, key: string): string {
  return parentPath === "" ? key : `${parentPath}.${key}`;
}

export function joinIndexPath(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`;
}

export function describePath(path: string): string {
  return path === "" ? "response" : path;
}

function hasOwn(objectValue: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

export function parseString(value: unknown, endpoint: string, path: string): string {
  if (typeof value !== "string") {
    throw new ApiContractError(endpoint, describePath(path), "string");
  }

  return value;
}

export function parseNullableString(value: unknown, endpoint: string, path: string): string | null {
  if (value === null) {
    return null;
  }

  return parseString(value, endpoint, path);
}

export function parseNumber(value: unknown, endpoint: string, path: string): number {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    throw new ApiContractError(endpoint, describePath(path), "number");
  }

  return value;
}

export function parseNullableNumber(value: unknown, endpoint: string, path: string): number | null {
  if (value === null) {
    return null;
  }

  return parseNumber(value, endpoint, path);
}

export function parseBoolean(value: unknown, endpoint: string, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiContractError(endpoint, describePath(path), "boolean");
  }

  return value;
}

export function parseObject(value: unknown, endpoint: string, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiContractError(endpoint, describePath(path), "object");
  }

  return value as JsonObject;
}

export function parseArray<ParsedValue>(
  value: unknown,
  endpoint: string,
  path: string,
  parseItem: ValueParser<ParsedValue>,
): ReadonlyArray<ParsedValue> {
  if (Array.isArray(value) === false) {
    throw new ApiContractError(endpoint, describePath(path), "array");
  }

  return value.map((item: unknown, index: number): ParsedValue => parseItem(item, endpoint, joinIndexPath(path, index)));
}

export function parseLiteral<ExpectedValue extends LiteralValue>(
  value: unknown,
  endpoint: string,
  path: string,
  expectedValue: ExpectedValue,
): ExpectedValue {
  if (value !== expectedValue) {
    throw new ApiContractError(endpoint, describePath(path), JSON.stringify(expectedValue));
  }

  return expectedValue;
}

export function parseEnum<EnumValue extends string | number>(
  value: unknown,
  endpoint: string,
  path: string,
  allowedValues: ReadonlyArray<EnumValue>,
): EnumValue {
  if (allowedValues.includes(value as EnumValue) === false) {
    const expected = `one of ${allowedValues.map((allowedValue: EnumValue): string => JSON.stringify(allowedValue)).join(", ")}`;
    throw new ApiContractError(endpoint, describePath(path), expected);
  }

  return value as EnumValue;
}

export function parseRequiredField<ParsedValue>(
  objectValue: JsonObject,
  key: string,
  endpoint: string,
  parentPath: string,
  parseValue: ValueParser<ParsedValue>,
): ParsedValue {
  return parseValue(objectValue[key], endpoint, joinPath(parentPath, key));
}

export function parseOptionalField<ParsedValue>(
  objectValue: JsonObject,
  key: string,
  endpoint: string,
  parentPath: string,
  parseValue: ValueParser<ParsedValue>,
): ParsedValue | undefined {
  if (hasOwn(objectValue, key) === false) {
    return undefined;
  }

  return parseValue(objectValue[key], endpoint, joinPath(parentPath, key));
}

export function parseStringArray(value: unknown, endpoint: string, path: string): ReadonlyArray<string> {
  return parseArray(value, endpoint, path, parseString);
}

export function parseNumberArray(value: unknown, endpoint: string, path: string): ReadonlyArray<number> {
  return parseArray(value, endpoint, path, parseNumber);
}
