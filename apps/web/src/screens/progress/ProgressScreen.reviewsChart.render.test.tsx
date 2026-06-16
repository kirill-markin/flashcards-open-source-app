// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  createNativeWeekRangeLabel,
  createProgressScreenRenderTestContext,
  localePreferenceStorageKey,
  mockProgressSourceStateWithInactivePreviousWeek,
} from "./ProgressScreenTestSupport";

describe("ProgressScreen reviews chart", () => {
  const progressScreen = createProgressScreenRenderTestContext();

  it("uses the active week local maximum for y-axis labels and bar heights", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const activeWeekMaxLabel = container.querySelector("[data-testid='progress-chart-y-label-max']");
    if (!(activeWeekMaxLabel instanceof HTMLSpanElement)) {
      throw new Error("Progress chart max y-axis label was not found");
    }
    expect(activeWeekMaxLabel.textContent).toBe("10");

    const latestWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-21']");
    if (!(latestWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Latest week bar was not found");
    }
    expect(latestWeekBar.style.height).toBe("90%");

    const previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    const previousWeekMaxLabel = container.querySelector("[data-testid='progress-chart-y-label-max']");
    if (!(previousWeekMaxLabel instanceof HTMLSpanElement)) {
      throw new Error("Updated progress chart max y-axis label was not found");
    }
    expect(previousWeekMaxLabel.textContent).toBe("44");

    const previousWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-14']");
    if (!(previousWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Previous week bar was not found");
    }
    expect(previousWeekBar.style.height).toContain("90.909");
  });

  it("renders stacked review ratings and supports day and rating selection", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const goodSegment = container.querySelector("[data-testid='progress-chart-segment-2026-04-21-good']");
    if (!(goodSegment instanceof HTMLSpanElement)) {
      throw new Error("Good rating segment was not found");
    }
    expect(goodSegment.style.backgroundColor).toBe("rgb(43, 182, 115)");

    const day20Bar = container.querySelector("[data-testid='progress-chart-bar-2026-04-20']");
    if (!(day20Bar instanceof HTMLSpanElement)) {
      throw new Error("Day 20 progress bar was not found");
    }

    await act(async () => {
      day20Bar.click();
    });

    const chartRange = container.querySelector("[data-testid='progress-chart-range']");
    if (!(chartRange instanceof HTMLParagraphElement)) {
      throw new Error("Progress chart range was not found");
    }
    expect(chartRange.textContent).toBe("Apr 20, 2026");

    const againButton = container.querySelector("[data-testid='progress-chart-rating-again']");
    if (!(againButton instanceof HTMLButtonElement)) {
      throw new Error("Again rating legend button was not found");
    }
    expect(againButton.disabled).toBe(true);
    expect(againButton.textContent).toBe("Again0 (0%)");

    const hardButton = container.querySelector("[data-testid='progress-chart-rating-hard']");
    if (!(hardButton instanceof HTMLButtonElement)) {
      throw new Error("Hard rating legend button was not found");
    }
    expect(hardButton.textContent).toBe("Hard3 (100%)");

    const dimmedHardSegment = container.querySelector("[data-testid='progress-chart-segment-2026-04-21-hard']");
    if (!(dimmedHardSegment instanceof HTMLSpanElement)) {
      throw new Error("Dimmed hard rating segment was not found");
    }
    expect(dimmedHardSegment.style.backgroundColor).toBe("rgb(122, 128, 136)");

    await act(async () => {
      hardButton.click();
    });

    expect(hardButton.closest("li")?.className).toContain("is-selected");
    expect(againButton.closest("li")?.className).toContain("is-dimmed");
    expect(container.querySelector("[data-testid='progress-chart-segment-2026-04-21-good']")).toBeNull();

    const filteredLatestWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-21']");
    if (!(filteredLatestWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Filtered latest week bar was not found");
    }
    expect(filteredLatestWeekBar.style.height).toBe("50%");

    const enabledAgainButton = container.querySelector("[data-testid='progress-chart-rating-again']");
    if (!(enabledAgainButton instanceof HTMLButtonElement)) {
      throw new Error("Enabled again rating legend button was not found");
    }

    await act(async () => {
      enabledAgainButton.click();
    });

    const filteredDayWithoutAgainBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-20']");
    if (!(filteredDayWithoutAgainBar instanceof HTMLSpanElement)) {
      throw new Error("Filtered day without again bar was not found");
    }
    expect(filteredDayWithoutAgainBar.style.height).toBe("0%");
    expect(filteredDayWithoutAgainBar.className).not.toContain("progress-chart-bar-active");
  });

  it("renders the week header with native locale interval formatting", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const chartRange = container.querySelector("[data-testid='progress-chart-range']");
    if (!(chartRange instanceof HTMLParagraphElement)) {
      throw new Error("Progress chart range was not found");
    }

    expect(chartRange.textContent).toBe(createNativeWeekRangeLabel("en", "2026-04-19", "2026-04-25"));
  });

  it("mirrors week navigation arrows for rtl locales", async () => {
    window.localStorage.setItem(localePreferenceStorageKey, "ar");

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    const nextWeekButton = container.querySelector("[data-testid='progress-chart-next-week']");
    if (!(nextWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Next week button was not found");
    }

    expect(document.documentElement.dir).toBe("rtl");
    expect(previousWeekButton.textContent).toBe(">");
    expect(nextWeekButton.textContent).toBe("<");
  });

  it("renders a full seven-column chart even when the week has no review activity", async () => {
    mockProgressSourceStateWithInactivePreviousWeek();

    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    let previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Updated previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    expect(container.textContent).not.toContain("No reviews yet in this week.");
    expect(container.querySelector("[data-testid='progress-chart-y-label-max']")).not.toBeNull();
    const inactiveWeekBars = container.querySelectorAll("[data-testid^='progress-chart-bar-']");
    expect(inactiveWeekBars).toHaveLength(7);
  });
});
