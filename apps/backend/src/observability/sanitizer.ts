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
const redactedContentValue = "<redacted-content>";
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
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "tokencount",
  "totaltokens",
]);

const contentKeyNames: ReadonlyArray<string> = [
  "args",
  "arguments",
  "fronttext",
  "backtext",
  "completion",
  "completions",
  "content",
  "contextline",
  "functionarguments",
  "functionargs",
  "genaicompletion",
  "genaicompletions",
  "genaiinputmessages",
  "genaioutputmessages",
  "genaiprompt",
  "genaiprompts",
  "headers",
  "httpquery",
  "httprequestheaders",
  "httpresponseheaders",
  "turninput",
  "localmessages",
  "message",
  "messagecontent",
  "modelinput",
  "modeloutput",
  "input",
  "inputmessages",
  "output",
  "outputmessages",
  "postcontext",
  "precontext",
  "prompt",
  "prompts",
  "query",
  "querystring",
  "requestquerystring",
  "requestbody",
  "requestheaders",
  "responsebody",
  "responseheaders",
  "rawbody",
  "rawresponsebody",
  "search",
  "searchparams",
  "toolarguments",
  "toolargs",
  "urlquery",
  "urlsearchparams",
  "vars",
  "body",
  "filedata",
  "imageurl",
];

const contentKeyFragments: ReadonlyArray<string> = [
  "functionarguments",
  "functionargs",
  "genaicompletion",
  "genaiprompt",
  "httpbody",
  "httpquery",
  "httpheader",
  "httprequestbody",
  "httprequestheader",
  "httpresponsebody",
  "httpresponseheader",
  "inputmessages",
  "messagecontent",
  "outputmessages",
  "rawbody",
  "rawresponsebody",
  "requestbody",
  "requestquerystring",
  "requestheader",
  "responsebody",
  "responseheader",
  "searchparams",
  "toolarguments",
  "toolargs",
  "urlquery",
  "urlsearchparams",
];

const exceptionTextKeyNames: ReadonlySet<string> = new Set([
  "errormessage",
  "errorstack",
  "errorvalue",
  "exceptionmessage",
  "exceptionvalue",
  "rawstack",
  "stack",
]);

const rawQuerySensitiveKeyNames: ReadonlySet<string> = new Set([
  "email",
  "input",
  "message",
  "prompt",
  "q",
  "query",
  "search",
  "user",
  "userid",
]);

const rawQuerySensitiveKeyFragments: ReadonlyArray<string> = [
  "message",
  "prompt",
  "query",
  "search",
  "user",
];

const maskPatterns: ReadonlyArray<Readonly<{
  pattern: RegExp;
  replacement: string;
}>> = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "<masked-email>",
  },
  {
    pattern: /(?<![-\w])\+\d{10,15}(?![-\w])/g,
    replacement: "<masked-phone>",
  },
  {
    pattern: /(?<![-\w])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?![-\w])/g,
    replacement: "<masked-phone>",
  },
  {
    pattern: /(?<![-\w])1?[2-9]\d{2}[2-9]\d{6}(?![-\w])/g,
    replacement: "<masked-phone>",
  },
  {
    pattern: /\b(?:sk|pk|rk)[_-][A-Za-z0-9_-]{16,}\b/g,
    replacement: "<masked-api-key>",
  },
  {
    pattern: /\bdata:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*;base64,[A-Za-z0-9+/=_-]+/gi,
    replacement: redactedBase64Value,
  },
  {
    pattern: /(?<![-\w])\d{12,19}(?![-\w])/g,
    replacement: "<masked-number>",
  },
];

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactSecretKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return secretKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function isOperationalTokenMetricKey(key: string): boolean {
  return operationalTokenMetricKeyNames.has(normalizeTelemetryKey(key));
}

function shouldRedactSecretEntry(key: string, value: unknown): boolean {
  if (typeof value === "number" && isOperationalTokenMetricKey(key)) {
    return false;
  }

  return shouldRedactSecretKey(key) && typeof value !== "boolean";
}

function shouldRedactContentKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return contentKeyNames.includes(normalizedKey)
    || contentKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function shouldRedactExceptionTextKey(key: string, value: unknown): boolean {
  return typeof value === "string" && exceptionTextKeyNames.has(normalizeTelemetryKey(key));
}

function isTextContentPart(value: unknown): value is Readonly<{
  type: string;
  text: string;
}> {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && "text" in value
    && (value as Readonly<{ type: unknown }>).type === "text"
    && typeof (value as Readonly<{ text: unknown }>).text === "string";
}

function isSentryExceptionValue(value: unknown): value is Readonly<{
  type?: unknown;
  value?: unknown;
  stacktrace?: unknown;
}> {
  return typeof value === "object"
    && value !== null
    && ("value" in value || "type" in value)
    && ("stacktrace" in value || "mechanism" in value);
}

function isSensitiveRawQueryKey(key: string): boolean {
  const normalizedKey = normalizeTelemetryKey(key);
  return rawQuerySensitiveKeyNames.has(normalizedKey)
    || rawQuerySensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment))
    || (
      secretKeyFragments.some((fragment) => normalizedKey.includes(fragment))
      && operationalTokenMetricKeyNames.has(normalizedKey) === false
    );
}

function isSensitiveRawQueryString(value: string): boolean {
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
    .some((part) => isSensitiveRawQueryKey(part.split("=", 1)[0] ?? ""));
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

  if (isSensitiveRawQueryString(valueWithoutUrlQueries)) {
    return redactedContentValue;
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

  if (shouldRedactExceptionTextKey(key, value)) {
    return redactedContentValue;
  }

  if (shouldRedactContentKey(key)) {
    return redactedContentValue;
  }

  return sanitizeBackendTelemetryValue(value);
}

function sanitizeTelemetryObject(
  value: Readonly<Record<string, unknown>>,
): SanitizedObject {
  const redactTextContentPart = isTextContentPart(value);
  const redactSentryExceptionValue = isSentryExceptionValue(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => {
      const normalizedKey = normalizeTelemetryKey(key);
      return [
        key,
        (redactTextContentPart && normalizedKey === "text")
          || (redactSentryExceptionValue && normalizedKey === "value" && typeof childValue === "string")
          ? redactedContentValue
          : sanitizeTelemetryEntry(key, childValue),
      ];
    }),
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
