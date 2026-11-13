// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { buildWorkspaceRoute, chatRoute } from "../../../../routes";
import type { ChatSessionSnapshot, StartChatRunRequestBody } from "../../../../types";
import {
  ApiErrorMock,
  createChatSnapshot,
  createChatFileUploadMock,
  createNewChatSessionMock,
  getChatSnapshotMock,
  queryChatComposerInput,
  queryChatSendButton,
  readStoredDraftInputText,
  setTextareaValue,
  setupChatPanelTest,
  startChatRunMock,
} from "../support/ChatPanelTestSupport";
import { WorkspaceAiImport } from "../../../../screens/settings/workspace/packages/WorkspaceAiImport";
import { aiImportSources, type AiImportSource } from "../../../../screens/settings/workspace/packages/aiImportSources";
import { ChatPanel } from "../../ChatPanel";

const { flushAsync, getContainer, renderChatPanelShell } = setupChatPanelTest();
const importRoute = "/import";
const workspaceChatRoute = buildWorkspaceRoute("workspace-1", chatRoute);

function findImportSource(id: AiImportSource["id"]): AiImportSource {
  const source = aiImportSources.find((candidate) => candidate.id === id);
  if (source === undefined) {
    throw new Error(`Missing import source ${id}`);
  }
  return source;
}

function ImportChatWithSidebar(): ReactElement {
  const [mode, setMode] = useState<"sidebar" | "fullscreen">("sidebar");
  return (
    <>
      <button data-testid="show-fullscreen-chat" type="button" onClick={() => setMode("fullscreen")}>Open fullscreen chat</button>
      <ChatPanel key={mode} mode={mode} />
    </>
  );
}

async function renderImport(sourceId: AiImportSource["id"], destination: ReactElement): Promise<void> {
  await renderChatPanelShell(
    <MemoryRouter initialEntries={[importRoute]}>
      <Routes>
        <Route path={importRoute} element={<WorkspaceAiImport source={findImportSource(sourceId)} />} />
        <Route path={workspaceChatRoute} element={destination} />
      </Routes>
    </MemoryRouter>,
    true,
  );
}

async function click(selector: string): Promise<void> {
  const button = getContainer().querySelector<HTMLButtonElement>(selector);
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
}

describe("ChatPanel AI import handoff", () => {
  it("waits for history and retries an unchanged pasted import with the same request ID", async () => {
    const history = Promise.withResolvers<ChatSessionSnapshot>();
    getChatSnapshotMock.mockReturnValueOnce(history.promise);
    startChatRunMock.mockRejectedValueOnce(new ApiErrorMock(503, "Run start response lost"));

    await renderImport("quizlet", <ChatPanel mode="fullscreen" />);

    const textInput = getContainer().querySelector<HTMLTextAreaElement>('[data-testid="workspace-ai-import-text-input"]');
    expect(textInput).not.toBeNull();
    await act(async () => setTextareaValue(textInput!, "hola\tHello"));
    await click('[data-testid="workspace-ai-import-start"]');

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock).not.toHaveBeenCalled();

    const sourceSessionId = createNewChatSessionMock.mock.calls[0][0] as string;
    await act(async () => history.resolve(createChatSnapshot({
      sessionId: sourceSessionId,
      conversationScopeId: sourceSessionId,
    })));
    await flushAsync();

    expect(getContainer().querySelector('[data-testid="chat-panel"]')).not.toBeNull();
    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    const targetSessionId = createNewChatSessionMock.mock.calls[1][0] as string;
    expect(targetSessionId).not.toBe(sourceSessionId);
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    const firstRequest = startChatRunMock.mock.calls[0][0] as StartChatRunRequestBody;
    expect(firstRequest.sessionId).toBe(targetSessionId);
    expect(createChatFileUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "quizlet.txt",
      sizeBytes: new Blob(["hola\tHello"]).size,
    }));
    expect(queryChatComposerInput(getContainer())?.value).not.toBe("");
    expect(readStoredDraftInputText("workspace-1", targetSessionId)).toBeNull();
    expect(queryChatSendButton(getContainer())?.disabled).toBe(false);

    await click('[data-testid="chat-send-button"]');
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(2);
    const retryRequest = startChatRunMock.mock.calls[1][0] as StartChatRunRequestBody;
    expect(retryRequest.sessionId).toBe(targetSessionId);
    expect(retryRequest.clientRequestId).toBe(firstRequest.clientRequestId);
    expect(retryRequest.content).toEqual(firstRequest.content);
    expect(queryChatComposerInput(getContainer())?.value).toBe("");
  });

  it("keeps an edited file import for manual send when fullscreen chat opens", async () => {
    await renderImport("other", <ImportChatWithSidebar />);

    const file = new File(["hola,Hello"], "cards.csv", { type: "text/csv" });
    const fileInput = getContainer().querySelector<HTMLInputElement>('[data-testid="workspace-ai-import-file-input"]');
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => fileInput?.dispatchEvent(new Event("change", { bubbles: true })));
    await click('[data-testid="workspace-ai-import-start"]');

    expect(createNewChatSessionMock).toHaveBeenCalledTimes(2);
    const targetSessionId = createNewChatSessionMock.mock.calls[1][0] as string;
    expect(startChatRunMock).not.toHaveBeenCalled();
    const composerInput = queryChatComposerInput(getContainer());
    expect(composerInput?.value).toBeTruthy();
    await act(async () => setTextareaValue(composerInput!, "Import this file into the Spanish deck"));

    await click('[data-testid="show-fullscreen-chat"]');
    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(queryChatComposerInput(getContainer())?.value).toBe("Import this file into the Spanish deck");

    await click('[data-testid="chat-send-button"]');
    await flushAsync();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    const request = startChatRunMock.mock.calls[0][0] as StartChatRunRequestBody;
    expect(request.sessionId).toBe(targetSessionId);
    expect(request.content).toContainEqual({ type: "text", text: "Import this file into the Spanish deck" });
    expect(createChatFileUploadMock).toHaveBeenCalledWith(expect.objectContaining({ fileName: "cards.csv" }));
  });
});
