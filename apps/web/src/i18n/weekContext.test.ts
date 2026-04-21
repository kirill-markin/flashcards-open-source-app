import { afterEach, describe, expect, it } from "vitest";
import { resolveLocaleWeekContext } from "./weekContext";

const originalGetWeekInfo = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "getWeekInfo");
const originalWeekInfo = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "weekInfo");

function restoreGetWeekInfo(): void {
  if (originalGetWeekInfo === undefined) {
    delete (Intl.Locale.prototype as Intl.Locale & Readonly<{ getWeekInfo?: unknown }>).getWeekInfo;
  } else {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", originalGetWeekInfo);
  }
}

function restoreWeekInfo(): void {
  if (originalWeekInfo === undefined) {
    delete (Intl.Locale.prototype as Intl.Locale & Readonly<{ weekInfo?: unknown }>).weekInfo;
  } else {
    Object.defineProperty(Intl.Locale.prototype, "weekInfo", originalWeekInfo);
  }
}

afterEach(() => {
  restoreGetWeekInfo();
  restoreWeekInfo();
});

describe("weekContext", () => {
  it("uses Intl.Locale week info when the runtime exposes it", () => {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", {
      configurable: true,
      value(): Readonly<{ firstDay: number }> {
        return {
          firstDay: 2,
        };
      },
    });

    expect(resolveLocaleWeekContext("en")).toEqual({
      firstDayOfWeek: 2,
    });
  });

  it("preserves browser region tags when deriving week boundaries", () => {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", {
      configurable: true,
      value(this: Intl.Locale): Readonly<{ firstDay: number }> {
        return {
          firstDay: this.toString() === "en-GB" ? 1 : 7,
        };
      },
    });

    expect(resolveLocaleWeekContext("en-GB", "en")).toEqual({
      firstDayOfWeek: 1,
    });
    expect(resolveLocaleWeekContext("en-US", "en")).toEqual({
      firstDayOfWeek: 0,
    });
  });

  it("falls back to the supported locale table when Intl.Locale.getWeekInfo is unavailable", () => {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", {
      configurable: true,
      value: undefined,
    });

    expect(resolveLocaleWeekContext("en")).toEqual({
      firstDayOfWeek: 0,
    });
    expect(resolveLocaleWeekContext("ar")).toEqual({
      firstDayOfWeek: 6,
    });
    expect(resolveLocaleWeekContext("es-ES")).toEqual({
      firstDayOfWeek: 1,
    });
  });

  it("falls back to the supported locale table when Intl.Locale exposes no week info API", () => {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(Intl.Locale.prototype, "weekInfo", {
      configurable: true,
      value: undefined,
    });

    expect(resolveLocaleWeekContext("en-GB", "en")).toEqual({
      firstDayOfWeek: 0,
    });
  });

  it("falls back to the supported locale table when the runtime returns invalid week info", () => {
    Object.defineProperty(Intl.Locale.prototype, "getWeekInfo", {
      configurable: true,
      value(): Readonly<{ firstDay: number }> {
        return {
          firstDay: 0,
        };
      },
    });

    expect(resolveLocaleWeekContext("es-MX")).toEqual({
      firstDayOfWeek: 0,
    });
  });
});
