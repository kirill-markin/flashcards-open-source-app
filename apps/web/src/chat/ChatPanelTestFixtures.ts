import type {
  ChatSessionHistoryMessage,
  ToolCallContentPart,
  WorkspaceSummary,
} from "../types";

type AsyncVoidFunction = () => Promise<void>;
type ErrorMessageSetter = (message: string) => void;

type ChatPanelAppDataMock = Readonly<{
  sessionVerificationState: "verified" | "unverified";
  activeWorkspace: WorkspaceSummary;
  isSessionVerified: boolean;
  localCardCount: number;
  refreshLocalData: AsyncVoidFunction;
  runSync: AsyncVoidFunction;
  setErrorMessage: ErrorMessageSetter;
}>;

type WorkspaceAppDataParams = Readonly<{
  refreshLocalData: AsyncVoidFunction;
  runSync: AsyncVoidFunction;
  setErrorMessage: ErrorMessageSetter;
}>;

type CompletedToolCallAssistantMessageParams = Readonly<{
  timestamp: number;
  isStopped: boolean;
  itemId: string | null;
  cursor: string | null;
}>;

const PRIMARY_WORKSPACE: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Primary",
  createdAt: "2026-03-10T00:00:00.000Z",
  isSelected: true,
};

export function createVerifiedWorkspaceAppDataMock(
  params: WorkspaceAppDataParams,
): ChatPanelAppDataMock {
  return {
    sessionVerificationState: "verified",
    activeWorkspace: PRIMARY_WORKSPACE,
    isSessionVerified: true,
    localCardCount: 1,
    refreshLocalData: params.refreshLocalData,
    runSync: params.runSync,
    setErrorMessage: params.setErrorMessage,
  };
}

export function createUnverifiedWorkspaceAppDataMock(
  params: WorkspaceAppDataParams,
): ChatPanelAppDataMock {
  return {
    sessionVerificationState: "unverified",
    activeWorkspace: PRIMARY_WORKSPACE,
    isSessionVerified: false,
    localCardCount: 1,
    refreshLocalData: params.refreshLocalData,
    runSync: params.runSync,
    setErrorMessage: params.setErrorMessage,
  };
}

export function createCompletedToolCallPart(): ToolCallContentPart {
  return {
    type: "tool_call",
    id: "tool-1",
    name: "search_cards",
    status: "completed",
    input: "{\"query\":\"biology\"}",
    output: "{\"matches\":3}",
  };
}

export function createCompletedToolCallAssistantMessage(
  params: CompletedToolCallAssistantMessageParams,
): ChatSessionHistoryMessage {
  return {
    role: "assistant",
    content: [createCompletedToolCallPart()],
    timestamp: params.timestamp,
    isError: false,
    isStopped: params.isStopped,
    itemId: params.itemId,
    cursor: params.cursor,
  };
}
