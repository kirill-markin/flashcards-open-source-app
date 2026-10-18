import type { Locale } from "../../../i18n/types";
import type { AiUsageStatus, BrowserGuestAiRefusal, ChatConfig, ChatComposerSuggestion } from "../../../types";
import type { ChatErrorFallbackMessages } from "../../shared/chatHelpers";
import type { ChatAttachmentLimitMessages } from "../../shared/chatSizePolicy";
import type { PendingAttachment } from "../../attachments/FileAttachment";
import type { StoredMessage } from "../../history/useChatHistory";
import type { ChatComposerAction, ChatRunState } from "../state/runState";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import type { ChatAiUsage } from "../aiUsage/useAiUsage";

export type ChatSessionControllerUiMessages = Readonly<{
  activeRunInProgress: string;
  currentChatRecovered: string;
  currentChatDraftConflict: string;
  formatAiLimitReached: (aiUsage: AiUsageStatus | null) => string;
  attachmentLimits: ChatAttachmentLimitMessages;
  attachmentUnsupported: string;
  attachmentUploadFailed: string;
  errorFallbacks: ChatErrorFallbackMessages;
  genericChatFailed: string;
  liveStreamEndedBeforeCompletion: string;
  newChatFailedPrefix: string;
  ownOpenAIKeyErrorPrefix: string;
  refreshFailedPrefix: string;
  remoteNotReady: string;
  requestFailedPrefix: string;
  requestTooLarge: string;
  stopFailedPrefix: string;
  transcriptionUnexpectedSessionId: string;
  unexpectedSessionId: string;
  workspaceRequired: string;
}>;

export type UseChatSessionControllerParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspaceId: string | null;
  isRemoteReady: boolean;
  uiLocale: Locale;
  onToolRunPostSyncRequested: () => Promise<void>;
  uiMessages: ChatSessionControllerUiMessages;
}>;

export type SendChatMessageParams = Readonly<{
  clientRequestId: string;
  text: string;
  attachments: ReadonlyArray<PendingAttachment>;
  isDraftTargetCurrent: () => boolean;
  onSessionDraftTargetReady: (sessionId: string) => number | null;
}>;

export type SendChatMessageResult =
  | Readonly<{ status: "accepted"; accepted: true; sessionId: string }>
  | Readonly<{ status: "rejected" | "stale"; accepted: false; sessionId: string | null; guestAiRefusal?: BrowserGuestAiRefusal }>;

export type ChatSessionController = Readonly<{
  messages: ReadonlyArray<StoredMessage>;
  runState: ChatRunState;
  isHistoryLoaded: boolean;
  isAssistantRunActive: boolean;
  isLiveStreamConnected: boolean;
  isStopping: boolean;
  currentSessionId: string | null;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  composerAction: ChatComposerAction;
  composerNotice: string | null;
  errorDialogMessage: string | null;
  aiUsage: AiUsageStatus | null;
  aiUsageLoadStatus: ChatAiUsage["aiUsageLoadStatus"];
  refreshAiUsage: () => void;
  dismissErrorDialog: () => void;
  acceptServerSessionId: (sessionId: string) => void;
  ensureRemoteSession: () => Promise<string>;
  sendMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  stopMessage: () => Promise<void>;
  clearConversation: () => Promise<string | null>;
}>;
