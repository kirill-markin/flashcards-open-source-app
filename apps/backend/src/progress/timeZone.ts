export type TimeZoneValidationIssue = "required" | "invalid";

/** timeZone is the caller's own spelling, trimmed, so a validator can echo back the value it was
 * given. canonicalTimeZone is Intl's resolved identifier, so europe/sofia and Europe/Sofia become
 * one value; use it wherever the timezone is persisted. */
export type TimeZoneValidationResult =
  | Readonly<{ ok: true; timeZone: string; canonicalTimeZone: string }>
  | Readonly<{ ok: false; issue: TimeZoneValidationIssue }>;

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const value = parts.find((part) => part.type === partType)?.value;
  if (value === undefined || value === "") {
    throw new Error(`Timezone date is missing ${partType}`);
  }

  return value;
}

export function validateIanaTimeZone(value: string): TimeZoneValidationResult {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return {
      ok: false,
      issue: "required",
    };
  }

  let canonicalTimeZone: string;
  try {
    canonicalTimeZone = new Intl.DateTimeFormat("en-US", { timeZone: trimmedValue })
      .resolvedOptions()
      .timeZone;
  } catch {
    return {
      ok: false,
      issue: "invalid",
    };
  }

  return {
    ok: true,
    timeZone: trimmedValue,
    canonicalTimeZone,
  };
}

export function requireIanaTimeZone(value: string, fieldName: string): string {
  const validation = validateIanaTimeZone(value);
  if (validation.ok) {
    return validation.canonicalTimeZone;
  }

  if (validation.issue === "required") {
    throw new Error(`${fieldName} is required`);
  }

  throw new Error(`${fieldName} must be a valid IANA timezone`);
}

export function formatDateAsTimeZoneLocalDate(value: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}
