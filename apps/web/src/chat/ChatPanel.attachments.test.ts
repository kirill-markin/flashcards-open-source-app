import { describe, expect, it } from "vitest";
import {
  createDropEvent,
  createChatSnapshot,
  getChatSnapshotMock,
  listOutboxRecordsMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
  setupChatPanelTest,
  startChatRunMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel attachments", () => {
  it("sends attachments as backend-owned content parts", async () => {
    getChatSnapshotMock.mockResolvedValueOnce(createChatSnapshot());

    await chatPanel.renderChatPanel();

    const attachButton = chatPanel.getContainer().querySelector(".chat-attach-btn");
    expect(attachButton).not.toBeNull();
    attachButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await chatPanel.flushAsync();
    await chatPanel.sendMessage("summarize this");

    expect(startChatRunMock.mock.calls[0]?.[0]).toEqual({
      sessionId: "session-1",
      content: [
        {
          type: "file",
          mediaType: "text/plain",
          base64Data: "YXR0YWNoZWQ=",
          fileName: "attached.txt",
        },
        {
          type: "text",
          text: "summarize this",
        },
      ],
      timezone: expect.any(String),
    });
  });

  it("blocks sending when sync outbox still has pending operations", async () => {
    listOutboxRecordsMock.mockResolvedValueOnce([{ operationId: "outbox-1" }]);

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("blocked");

    expect(startChatRunMock).not.toHaveBeenCalled();
  });

  it("alerts when an oversized compressed attachment still exceeds the payload limit", async () => {
    prepareAttachmentMock.mockResolvedValueOnce({
      fileName: "huge-image.jpg",
      mediaType: "image/jpeg",
      base64Data: "a".repeat(11_000_000),
    });
    recompressImageAttachmentMock.mockResolvedValueOnce({
      fileName: "huge-image.jpg",
      mediaType: "image/jpeg",
      base64Data: "b".repeat(11_000_000),
    });

    await chatPanel.renderChatPanel();
    const oversizedFile = new File(["image"], "huge-image.jpg", { type: "image/jpeg" });
    const chatRoot = chatPanel.getContainer().querySelector(".chat-sidebar-fullscreen");
    expect(chatRoot).not.toBeNull();
    chatRoot?.dispatchEvent(createDropEvent(oversizedFile));
    await chatPanel.flushAsync();

    expect(chatPanel.getAlertMock()).toHaveBeenCalled();
  });
});
