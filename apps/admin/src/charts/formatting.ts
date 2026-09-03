function parseCalendarDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) {
    throw new Error(`Invalid report date: ${date}`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report date: ${date}`);
  }

  return parsedDate;
}

export function formatDateRangeLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(parseCalendarDate(date));
}

export function formatCompactDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  }).format(parseCalendarDate(date));
}

export function formatGeneratedAt(value: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  return `${formatted} UTC`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
