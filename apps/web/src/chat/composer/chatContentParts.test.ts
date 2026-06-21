import { describe, expect, it } from "vitest";
import type { ContentPart } from "../../types";
import type { PendingAttachment } from "../attachments/FileAttachment";
import {
  buildContentParts,
  buildStartRunContentParts,
} from "../shared/chatHelpers";

describe("chat content parts", () => {
  it("keeps card effort out of local content and adds it only for the legacy start-run wire payload", () => {
    const attachments: ReadonlyArray<PendingAttachment> = [{
      type: "card",
      attachmentId: "attachment-1",
      cardId: "card-1",
      frontText: "Front",
      backText: "Back",
      tags: ["grammar"],
    }];
    const contentParts = buildContentParts("", attachments);

    expect(contentParts).toEqual<ReadonlyArray<ContentPart>>([{
      type: "card",
      cardId: "card-1",
      frontText: "Front",
      backText: "Back",
      tags: ["grammar"],
    }]);
    expect(buildStartRunContentParts(contentParts)).toEqual([{
      type: "card",
      cardId: "card-1",
      frontText: "Front",
      backText: "Back",
      tags: ["grammar"],
      effortLevel: "fast",
    }]);
  });
});
