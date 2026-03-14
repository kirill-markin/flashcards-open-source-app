// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createDropEvent,
  createLocalChatRequestBodyMock,
  ensurePersistentStorageMock,
  prepareAttachmentMock,
  recompressImageAttachmentMock,
  setupChatPanelTest,
  streamLocalChatMock,
} from "./ChatPanelTestSupport";

const chatPanel = setupChatPanelTest();

describe("ChatPanel attachments", () => {
  it("blocks send before network when post-compression payload exceeds the 9.5 MB safety limit", async () => {
    const oversizedPayload = "x".repeat(10_100_000);
    createLocalChatRequestBodyMock.mockImplementation(
      (messages: ReadonlyArray<unknown>, model: string, timezone: string, userContext: unknown) => ({
        messages,
        model,
        timezone,
        userContext,
        oversizedPayload,
      }),
    );

    await chatPanel.renderChatPanel();
    await chatPanel.sendMessage("trigger limit");

    expect(streamLocalChatMock).not.toHaveBeenCalled();
    expect(ensurePersistentStorageMock).not.toHaveBeenCalled();
    expect(chatPanel.getContainer().textContent).toContain("Attachment payload limit is 10 MB after compression.");
  });

  it("rejects oversized projected attachment payload before send and keeps pending list unchanged", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    prepareAttachmentMock.mockResolvedValue({
      fileName: "photo.png",
      mediaType: "image/jpeg",
      base64Data: "x".repeat(9_970_000),
    });
    recompressImageAttachmentMock.mockResolvedValue({
      fileName: "photo.png",
      mediaType: "image/jpeg",
      base64Data: "x".repeat(9_970_000),
    });

    await chatPanel.renderChatPanel();

    const chatRoot = chatPanel.getContainer().querySelector(".chat-sidebar-fullscreen");
    expect(chatRoot).not.toBeNull();
    if (chatRoot === null) {
      throw new Error("Expected chat root");
    }

    await act(async () => {
      const file = new File(["123"], "photo.png", { type: "image/png" });
      chatRoot.dispatchEvent(createDropEvent(file));
      await Promise.resolve();
    });

    expect(recompressImageAttachmentMock).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("Attachment payload limit is 10 MB after compression.");
    expect(chatPanel.getContainer().querySelector(".chat-attachment-chip")).toBeNull();
    alertSpy.mockRestore();
  });

  it("passes active card totals into local chat request bodies for sends and attachment draft checks", async () => {
    prepareAttachmentMock.mockResolvedValue({
      fileName: "notes.txt",
      mediaType: "text/plain",
      base64Data: "dGVzdA==",
    });

    await chatPanel.renderChatPanel();

    const chatRoot = chatPanel.getContainer().querySelector(".chat-sidebar-fullscreen");
    expect(chatRoot).not.toBeNull();
    if (chatRoot === null) {
      throw new Error("Expected chat root");
    }

    await act(async () => {
      const file = new File(["hello"], "notes.txt", { type: "text/plain" });
      chatRoot.dispatchEvent(createDropEvent(file));
      await Promise.resolve();
    });

    expect(createLocalChatRequestBodyMock.mock.calls[0]?.[3]).toEqual({
      totalCards: 1,
    });

    await chatPanel.sendMessage("hello");

    expect(createLocalChatRequestBodyMock.mock.calls.some((call) => JSON.stringify(call[3]) === JSON.stringify({
      totalCards: 1,
    }))).toBe(true);
  });

  it("renders the attach control as an icon button with an accessible label", async () => {
    await chatPanel.renderChatPanel();

    const attachButton = chatPanel.getContainer().querySelector(".chat-attach-btn");
    expect(attachButton?.getAttribute("aria-label")).toBe("Add attachment");
    expect(attachButton?.textContent).toBe("");
    expect(attachButton?.querySelector(".chat-attach-btn-icon")).not.toBeNull();
  });
});
