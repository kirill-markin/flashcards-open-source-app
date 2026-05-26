// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ApiErrorMock,
  AuthRedirectErrorMock,
  captureWebExceptionMock,
  setupChatPanelTest,
  startChatRunMock,
} from "./ChatPanelTestSupport";

const {
  flushAsync,
  getContainer,
  renderChatPanel,
  sendMessage,
} = setupChatPanelTest();

describe("ChatPanel error observation", () => {
  it("does not capture expected chat request failures", async () => {
    startChatRunMock.mockRejectedValue(Object.assign(
      new ApiErrorMock(400, "content must be a non-empty array", null),
      { responseBodyKind: "json" as const },
    ));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("invalid request");
    await flushAsync();
    await flushAsync();

    expect(captureWebExceptionMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("captures unknown coded 4xx chat request failures", async () => {
    const requestError = Object.assign(
      new ApiErrorMock(400, "Unexpected chat state.", "CHAT_NEW_CLIENT_STATE"),
      { responseBodyKind: "json" as const },
    );
    startChatRunMock.mockRejectedValue(requestError);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("unknown client state");
    await flushAsync();
    await flushAsync();

    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "chat_run_request_failed",
      error: requestError,
    }));
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("does not capture oversized chat request failures", async () => {
    startChatRunMock.mockRejectedValue(new ApiErrorMock(
      413,
      "AI chat request is too large.",
      "CHAT_REQUEST_TOO_LARGE",
    ));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("oversized request");
    await flushAsync();
    await flushAsync();

    expect(captureWebExceptionMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).toContain("Message is too large.");
  });

  it("captures non-json 4xx chat request failures", async () => {
    const requestError = Object.assign(
      new ApiErrorMock(400, "Bad request", null),
      { responseBodyKind: "text" as const },
    );
    startChatRunMock.mockRejectedValue(requestError);

    await renderChatPanel();
    await flushAsync();
    await sendMessage("non-json client error");
    await flushAsync();
    await flushAsync();

    expect(captureWebExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "chat_run_request_failed",
      error: requestError,
    }));
    expect(getContainer().textContent).toContain("Chat request failed.");
  });

  it("does not capture auth redirect chat request failures", async () => {
    startChatRunMock.mockRejectedValue(new AuthRedirectErrorMock("https://auth.example.com/login"));

    await renderChatPanel();
    await flushAsync();
    await sendMessage("expired session");
    await flushAsync();
    await flushAsync();

    expect(captureWebExceptionMock).not.toHaveBeenCalled();
    expect(getContainer().textContent).toContain("Chat request failed.");
  });
});
