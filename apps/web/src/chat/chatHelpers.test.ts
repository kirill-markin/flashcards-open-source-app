import { describe, expect, it } from "vitest";
import { calculateSidebarWidthFromPointer } from "./chatHelpers";

describe("calculateSidebarWidthFromPointer", () => {
  it("measures the dragged width from the sidebar left edge instead of the viewport", () => {
    expect(calculateSidebarWidthFromPointer(452, 128, 280, 600)).toBe(324);
  });

  it("clamps the dragged width to the configured min and max values", () => {
    expect(calculateSidebarWidthFromPointer(200, 32, 280, 600)).toBe(280);
    expect(calculateSidebarWidthFromPointer(900, 32, 280, 600)).toBe(600);
  });
});
