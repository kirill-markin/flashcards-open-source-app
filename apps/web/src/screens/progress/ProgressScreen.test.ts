import { describe, expect, it } from "vitest";
import { shiftLocalDate } from "../../progress/progressDates";
import type { StreakDay, StreakDayState } from "../../types";
import { buildStreakWeeks } from "./streak/progressStreakModel";

type DateFormatter = (
  value: Date | number | string,
  options?: Readonly<Intl.DateTimeFormatOptions>,
) => string;

function createDateFormatter(locale: string): DateFormatter {
  return function formatDate(value: Date | number | string, options?: Readonly<Intl.DateTimeFormatOptions>): string {
    return new Intl.DateTimeFormat(locale, options).format(new Date(value));
  };
}

function createStreakDays(
  from: string,
  to: string,
  reviewedDates: ReadonlySet<string>,
): ReadonlyArray<StreakDay> {
  const days: Array<StreakDay> = [];

  for (let currentDate = from; currentDate <= to; currentDate = shiftLocalDate(currentDate, 1)) {
    const state: StreakDayState = reviewedDates.has(currentDate) ? "reviewed" : "missed";
    days.push({
      date: currentDate,
      state,
    });
  }

  return days;
}

describe("ProgressScreen streak weeks", () => {
  it("marks future dates in the current locale-aligned week as placeholders", () => {
    const weeks = buildStreakWeeks(
      [
        { date: "2026-04-18", reviewCount: 3, againCount: 0, hardCount: 0, goodCount: 3, easyCount: 0 },
        { date: "2026-04-20", reviewCount: 2, againCount: 0, hardCount: 0, goodCount: 2, easyCount: 0 },
        { date: "2026-04-21", reviewCount: 4, againCount: 0, hardCount: 0, goodCount: 4, easyCount: 0 },
      ],
      createStreakDays("2026-03-23", "2026-04-21", new Set([
        "2026-04-18",
        "2026-04-20",
        "2026-04-21",
      ])),
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
