type SanitizedObject = Readonly<{
  [key: string]: SanitizedTelemetryValue;
}>;

export type SanitizedTelemetryValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | ReadonlyArray<SanitizedTelemetryValue>
  | SanitizedObject;

const redactedSecretValue = "<redacted-secret>";
const redactedBase64Value = "<redacted-base64>";

const secretKeyFragments: ReadonlyArray<string> = [
  "authorization",
  "cookie",
  "csrf",
  "otp",
  "password",
  "secret",
  "token",
  "apikey",
];

const operationalTokenMetricKeyNames: ReadonlySet<string> = new Set([
  "completiontokens",
  "genaiusageinputtokens",
  "genaiusageoutputtokens",
  "genaiusagetotaltokens",
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "tokencount",
  "totaltokens",
]);

type TextMaskPattern = Readonly<{
  pattern: RegExp;
  replacement: string;
}>;

// Secret text masks shared by the CloudWatch and Sentry paths.
export const secretTextMaskPatterns: ReadonlyArray<TextMaskPattern> = [
  {
    // Google Play purchase tokens embedded in androidpublisher URL paths; keeps the `:acknowledge`-style suffix.
    // First, so no other mask can split a token; at most two segments before `tokens/` keeps matching linear.
    pattern: /(\/purchases\/(?:[^\s"'<>?#):/]+\/){0,2}tokens\/)[^\s"'<>?#):/]+/g,
    replacement: "$1<masked-purchase-token>",
  },
  {
    pattern: /\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b/g,
    replacement: "<masked-api-key>",
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "<masked-jwt>",
  },
];

const maskPatterns: ReadonlyArray<TextMaskPattern> = [
  {
    // Before the secret masks, so a key-like run inside the payload cannot split the data URL.
    pattern: /\bdata:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*;base64,[A-Za-z0-9+/=_-]+/gi,
    replacement: redactedBase64Value,
  },
  ...secretTextMaskPatterns,
];

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactSecretKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return secretKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

export function isOperationalTokenMetricKey(key: string): boolean {
  return operationalTokenMetricKeyNames.has(normalizeTelemetryKey(key));
}

function shouldRedactSecretEntry(key: string, value: unknown): boolean {
  if (typeof value === "number" && isOperationalTokenMetricKey(key)) {
    return false;
  }

  return shouldRedactSecretKey(key) && typeof value !== "boolean";
}

function isSecretRawQueryKey(key: string): boolean {
  return shouldRedactSecretKey(key) && isOperationalTokenMetricKey(key) === false;
}

export function isSecretRawQueryString(value: string): boolean {
  const trimmedValue = value.trim().replace(/^\?/, "");
  if (
    trimmedValue === ""
    || trimmedValue.includes("=") === false
    || /^[A-Za-z0-9._~%!$&'()*+,;=:@/?-]+$/.test(trimmedValue) === false
  ) {
    return false;
  }

  return trimmedValue
    .split(/[&;]/)
    .some((part) => isSecretRawQueryKey(part.split("=", 1)[0] ?? ""));
}

function isSerializedJsonContainerString(value: string): boolean {
  const trimmedValue = value.trim();
  return (trimmedValue.startsWith("{") && trimmedValue.endsWith("}"))
    || (trimmedValue.startsWith("[") && trimmedValue.endsWith("]"));
}

function sanitizeSerializedJsonContainerString(value: string): string | null {
  if (isSerializedJsonContainerString(value) === false) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);
    if (
      (typeof parsedValue !== "object" || parsedValue === null)
      && Array.isArray(parsedValue) === false
    ) {
      return null;
    }

    return JSON.stringify(sanitizeBackendTelemetryValue(parsedValue));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function sanitizeString(value: string): string {
  const serializedJsonValue = sanitizeSerializedJsonContainerString(value);
  if (serializedJsonValue !== null) {
    return serializedJsonValue;
  }

  const valueWithoutUrlQueries = value
    .replace(/\b(https?:\/\/[^\s?#"'<>]+)\?(?!<redacted-query>)[^\s"'<>)]*/gi, "$1?<redacted-query>")
    .replace(/(?<![A-Za-z0-9])((?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+)\?(?!<redacted-query>)[^\s"'<>)]*/g, "$1?<redacted-query>");

  if (isSecretRawQueryString(valueWithoutUrlQueries)) {
    return redactedSecretValue;
  }

  return maskPatterns.reduce(
    (currentValue, rule) => currentValue.replace(rule.pattern, rule.replacement),
    valueWithoutUrlQueries,
  );
}

function sanitizeTelemetryEntry(
  key: string,
  value: unknown,
): SanitizedTelemetryValue {
  const normalizedKey = normalizeTelemetryKey(key);
  if (normalizedKey === "base64data") {
    return redactedBase64Value;
  }

  if (shouldRedactSecretEntry(key, value)) {
    return redactedSecretValue;
  }

  return sanitizeBackendTelemetryValue(value);
}

function sanitizeTelemetryObject(
  value: Readonly<Record<string, unknown>>,
): SanitizedObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => [key, sanitizeTelemetryEntry(key, childValue)]),
  );
}

export function sanitizeBackendTelemetryValue(value: unknown): SanitizedTelemetryValue {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBackendTelemetryValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeTelemetryObject(value as Readonly<Record<string, unknown>>);
  }

  return undefined;
}
