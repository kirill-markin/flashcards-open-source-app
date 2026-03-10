import { describe, expect, it } from "vitest";
import { formatToolLabel } from "./ChatPanel";

describe("formatToolLabel", () => {
  it("renders plural-only card tool labels", () => {
    expect(formatToolLabel("get_cards")).toBe("Get cards");
    expect(formatToolLabel("create_cards")).toBe("Create cards");
    expect(formatToolLabel("update_cards")).toBe("Update cards");
    expect(formatToolLabel("delete_cards")).toBe("Delete cards");
  });
});
