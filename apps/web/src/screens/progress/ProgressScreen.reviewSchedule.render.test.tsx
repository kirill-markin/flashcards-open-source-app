// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProgressScreenRenderTestContext } from "./ProgressScreenTestSupport";

describe("ProgressScreen review schedule", () => {
  const progressScreen = createProgressScreenRenderTestContext();

  it("renders the review schedule donut and ordered bucket list", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    const reviewScheduleCard = container.querySelector("[data-testid='progress-review-schedule-card']");
    if (!(reviewScheduleCard instanceof HTMLElement)) {
      throw new Error("Review schedule card was not found");
    }

    expect(reviewScheduleCard.textContent).toContain("Review schedule");
    expect(reviewScheduleCard.textContent).toContain("Total cards: 10");

    const bucketRows = [...reviewScheduleCard.querySelectorAll(".progress-review-schedule-row")];
    expect(bucketRows.map((row) => row.textContent)).toEqual([
      "New220%",
      "Today330%",
      "1-7 days110%",
      "8-30 days110%",
      "31-90 days110%",
      "91-360 days110%",
      "1-2 years00%",
      "Later110%",
    ]);

    const donut = reviewScheduleCard.querySelector(".progress-review-schedule-donut");
    if (!(donut instanceof SVGSVGElement)) {
      throw new Error("Review schedule donut was not found");
    }
    expect(donut.getAttribute("role")).toBe("img");
    expect(donut.getAttribute("aria-label")).toBe("Review schedule");

    const donutSegments = [...donut.querySelectorAll("[data-testid^='progress-review-schedule-segment-']")];
    expect(donutSegments.map((segment) => segment.getAttribute("data-testid"))).toEqual([
      "progress-review-schedule-segment-new",
      "progress-review-schedule-segment-today",
      "progress-review-schedule-segment-days1To7",
      "progress-review-schedule-segment-days8To30",
      "progress-review-schedule-segment-days31To90",
      "progress-review-schedule-segment-days91To360",
      "progress-review-schedule-segment-later",
    ]);
    expect(donutSegments[0]?.getAttribute("fill")).toBe("#F4C430");
    expect(donutSegments[0]?.getAttribute("d")).toContain("A 100 100");
  });
});
