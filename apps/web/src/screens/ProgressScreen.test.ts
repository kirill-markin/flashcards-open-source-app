import { describe, expect, it } from "vitest";
import { buildStreakWeeks } from "./ProgressScreen";

type DateFormatter = (
  value: Date | number | string,
  options?: Readonly<Intl.DateTimeFormatOptions>,
) => string;

function createDateFormatter(locale: string): DateFormatter {
  return function formatDate(value: Date | number | string, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return new Intl.DateTimeFormat(locale, options).format(new Date(value));
  };
}

describe("ProgressScreen streak weeks", () => {
  it("marks future dates in the current locale-aligned week as placeholders", () => {
    const weeks = buildStreakWeeks(
      [
        { date: "2026-04-18", reviewCount: 3 },
        { date: "2026-04-20", reviewCount: 2 },
        { date: "2026-04-21", reviewCount: 4 },
      ],
      "2026-04-21",
      createDateFormatter("en-US"),
      { firstDayOfWeek: 1 },
    );

    expect(weeks).toHaveLength(5);
    expect(weeks[4]?.map((day) => day.date)).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
    ]);
    expect(weeks[4]?.map((day) => day.isFuture)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(weeks[4]?.map((day) => day.reviewCount)).toEqual([2, 4, 0, 0, 0, 0, 0]);
    expect(weeks[3]?.some((day) => day.isFuture)).toBe(false);
  });
});
