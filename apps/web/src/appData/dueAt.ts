const dueAtTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
export const nullDueAtBucketMillis: number = Number.MIN_SAFE_INTEGER;
export const malformedDueAtBucketMillis: number = Number.MIN_SAFE_INTEGER + 1;

type ParsedDueAtParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMilliseconds: number;
}>;

function parseIntegerPart(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    throw new Error(`Timestamp part is not numeric: ${value}`);
  }

  return parsedValue;
}

function parseMillisecondPart(fractionalSecond: string | undefined): number {
  if (fractionalSecond === undefined) {
    return 0;
  }

  return parseIntegerPart(fractionalSecond.padEnd(3, "0").slice(0, 3));
}

function parseOffsetMilliseconds(offset: string): number | null {
  if (offset === "Z") {
    return 0;
  }

  const sign = offset[0];
  const hourText = offset.slice(1, 3);
  const minuteText = offset.slice(4, 6);
  const hour = parseIntegerPart(hourText);
  const minute = parseIntegerPart(minuteText);
  if (hour > 23 || minute > 59) {
    return null;
  }

  const offsetMilliseconds = ((hour * 60) + minute) * 60 * 1000;
  return sign === "-" ? -offsetMilliseconds : offsetMilliseconds;
}

function makeUtcTimestamp(parts: ParsedDueAtParts): number | null {
  if (
    parts.month < 1
    || parts.month > 12
    || parts.day < 1
    || parts.hour > 23
    || parts.minute > 59
    || parts.second > 59
  ) {
    return null;
  }

  const utcDate = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ));
  utcDate.setUTCFullYear(parts.year);

  if (
    utcDate.getUTCFullYear() !== parts.year
    || utcDate.getUTCMonth() !== parts.month - 1
    || utcDate.getUTCDate() !== parts.day
    || utcDate.getUTCHours() !== parts.hour
    || utcDate.getUTCMinutes() !== parts.minute
    || utcDate.getUTCSeconds() !== parts.second
    || utcDate.getUTCMilliseconds() !== parts.millisecond
  ) {
    return null;
  }

  const timestamp = utcDate.getTime() - parts.offsetMilliseconds;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseDueAtMillis(dueAt: string): number | null {
  const match = dueAtTimestampPattern.exec(dueAt);
  if (match === null) {
    return null;
  }

  const offset = match[8];
  if (offset === undefined) {
    throw new Error(`Timestamp offset is missing: ${dueAt}`);
  }

  const offsetMilliseconds = parseOffsetMilliseconds(offset);
  if (offsetMilliseconds === null) {
    return null;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const hourText = match[4];
  const minuteText = match[5];
  const secondText = match[6];
  if (
    yearText === undefined
    || monthText === undefined
    || dayText === undefined
    || hourText === undefined
    || minuteText === undefined
    || secondText === undefined
  ) {
    throw new Error(`Timestamp calendar parts are missing: ${dueAt}`);
  }

  return makeUtcTimestamp({
    year: parseIntegerPart(yearText),
    month: parseIntegerPart(monthText),
    day: parseIntegerPart(dayText),
    hour: parseIntegerPart(hourText),
    minute: parseIntegerPart(minuteText),
    second: parseIntegerPart(secondText),
    millisecond: parseMillisecondPart(match[7]),
    offsetMilliseconds,
  });
}

export function deriveDueAtMillis(dueAt: string | null): number | null {
  if (dueAt === null) {
    return null;
  }

  return parseDueAtMillis(dueAt);
}

export function deriveDueAtBucketMillis(dueAt: string | null): number {
  if (dueAt === null) {
    return nullDueAtBucketMillis;
  }

  const dueAtMillis = parseDueAtMillis(dueAt);
  return dueAtMillis ?? malformedDueAtBucketMillis;
}

export function canonicalizeDueAtForSync(cardId: string, dueAt: string | null): string | null {
  const dueAtMillis = deriveDueAtMillis(dueAt);
  if (dueAtMillis !== null) {
    return new Date(dueAtMillis).toISOString();
  }

  if (dueAt === null) {
    return null;
  }

  throw new Error(`Card ${cardId} has invalid dueAt for sync: ${dueAt}`);
}
