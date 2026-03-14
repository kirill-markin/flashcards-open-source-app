import { describe, expect, it } from "vitest";
import { formatToolLabel } from "./chatMessageContent";

describe("formatToolLabel", () => {
  it("renders labels for the reduced local tool surface", () => {
    expect(formatToolLabel("sql")).toBe("SQL");
    expect(formatToolLabel("get_cloud_settings")).toBe("Cloud settings");
    expect(formatToolLabel("list_outbox")).toBe("Outbox");
  });
});
