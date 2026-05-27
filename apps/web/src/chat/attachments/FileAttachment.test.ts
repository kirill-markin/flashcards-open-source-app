// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { checkFileSize, prepareAttachment } from "./FileAttachment";

describe("prepareAttachment", () => {
  it("treats common image extensions as images when the browser omits MIME", () => {
    const file = new File([new Uint8Array(4 * 1024 * 1024)], "photo.jpg", {
      type: "",
    });

    expect(checkFileSize(file)).toBeNull();
  });

  it("normalizes CSV MIME aliases before storing the pending attachment", async () => {
    const file = new File(["front,back"], "deck.csv", {
      type: "text/comma-separated-values",
    });

    const attachment = await prepareAttachment(file);

    expect(attachment.type).toBe("binary");
    if (attachment.type !== "binary") {
      throw new Error("Expected a binary attachment.");
    }
    expect(attachment.fileName).toBe("deck.csv");
    expect(attachment.mediaType).toBe("text/csv");
    expect(attachment.base64Data).toBe("ZnJvbnQsYmFjaw==");
  });

  it("normalizes XML MIME aliases before storing the pending attachment", async () => {
    const file = new File(["<cards />"], "cards.xml", {
      type: "application/xml",
    });

    const attachment = await prepareAttachment(file);

    expect(attachment.type).toBe("binary");
    if (attachment.type !== "binary") {
      throw new Error("Expected a binary attachment.");
    }
    expect(attachment.fileName).toBe("cards.xml");
    expect(attachment.mediaType).toBe("text/xml");
    expect(attachment.base64Data).toBe("PGNhcmRzIC8+");
  });
});
