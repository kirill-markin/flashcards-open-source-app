import { describe, expect, it } from "vitest";
import { formatToolLabel } from "./ChatPanel";

describe("formatToolLabel", () => {
  it("renders plural-only card and deck tool labels", () => {
    expect(formatToolLabel("get_cards")).toBe("Get cards");
    expect(formatToolLabel("create_cards")).toBe("Create cards");
    expect(formatToolLabel("update_cards")).toBe("Update cards");
    expect(formatToolLabel("delete_cards")).toBe("Delete cards");
    expect(formatToolLabel("list_decks")).toBe("List decks");
    expect(formatToolLabel("search_decks")).toBe("Search decks");
    expect(formatToolLabel("get_decks")).toBe("Get decks");
    expect(formatToolLabel("create_decks")).toBe("Create decks");
    expect(formatToolLabel("update_decks")).toBe("Update decks");
    expect(formatToolLabel("delete_decks")).toBe("Delete decks");
    expect(formatToolLabel("summarize_deck_state")).toBe("Deck summary");
  });
});
