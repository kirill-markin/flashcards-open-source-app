export type TimeZoneValidationIssue = "required" | "invalid";

export type TimeZoneValidationResult =
  | Readonly<{ ok: true; timeZone: string }>
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

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmedValue });
  } catch {
    return {
      ok: false,
      issue: "invalid",
    };
  }

  return {
    ok: true,
    timeZone: trimmedValue,
  };
}

export function requireIanaTimeZone(value: string, fieldName: string): string {
  const validation = validateIanaTimeZone(value);
  if (validation.ok) {
    return validation.timeZone;
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
