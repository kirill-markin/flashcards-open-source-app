import { describe, expect, it } from "vitest";
import { formatCardFilterSummary } from "./cardFilters";
import { formatDeckFilterDefinition } from "./deckFilters";

describe("filter summaries", () => {
  it("formats card filters with explicit tag OR wording", () => {
    expect(formatCardFilterSummary({
      tags: ["grammar", "verbs"],
      effort: [],
    })).toBe("tags any of grammar, verbs");

    expect(formatCardFilterSummary({
      tags: ["grammar"],
      effort: ["fast"],
    })).toBe("effort in fast AND tags any of grammar");
  });

  it("formats deck filters with explicit tag OR wording", () => {
    expect(formatDeckFilterDefinition({
      version: 2,
      effortLevels: ["fast"],
      tags: ["grammar", "verbs"],
    })).toBe("effort in fast AND tags any of grammar, verbs");
  });
});
