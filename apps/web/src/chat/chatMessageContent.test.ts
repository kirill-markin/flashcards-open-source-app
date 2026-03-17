import { describe, expect, it } from "vitest";
import { formatToolLabel } from "./chatMessageContent";

describe("formatToolLabel", () => {
  it("renders labels for supported backend tools", () => {
    expect(formatToolLabel("sql")).toBe("SQL");
    expect(formatToolLabel("code_interpreter")).toBe("Code execution");
    expect(formatToolLabel("web_search")).toBe("Web search");
  });
});
