import {
  generateFollowUpChatComposerSuggestions,
} from "../composerSuggestions";
import {
  startOpenAILoop,
} from "../openai/loop";
import {
  completeClaimedChatRun,
  persistClaimedChatRunCancelled,
  persistClaimedChatRunTerminalError,
  touchClaimedChatRunHeartbeat,
} from "../runs";
import {
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
} from "../store";
import {
  startChatTurnObservation,
} from "../../telemetry/langfuse";

export type ChatRuntimeDependencies = Readonly<{
  startChatTurnObservation: typeof startChatTurnObservation;
  startOpenAILoop: typeof startOpenAILoop;
  generateFollowUpChatComposerSuggestions: typeof generateFollowUpChatComposerSuggestions;
  completeChatRun: typeof completeClaimedChatRun;
  persistAssistantCancelled: typeof persistClaimedChatRunCancelled;
  persistAssistantTerminalError: typeof persistClaimedChatRunTerminalError;
  touchChatRunHeartbeat: typeof touchClaimedChatRunHeartbeat;
  updateAssistantMessageItem: typeof updateAssistantMessageItem;
  updateAssistantMessageItemAndInvalidateMainContent: typeof updateAssistantMessageItemAndInvalidateMainContent;
  beginTaskProtection: () => Promise<void>;
  endTaskProtection: () => Promise<void>;
}>;

export const DEFAULT_CHAT_RUNTIME_DEPENDENCIES: ChatRuntimeDependencies = {
  startChatTurnObservation,
  startOpenAILoop,
  generateFollowUpChatComposerSuggestions,
  completeChatRun: completeClaimedChatRun,
  persistAssistantCancelled: persistClaimedChatRunCancelled,
  persistAssistantTerminalError: persistClaimedChatRunTerminalError,
  touchChatRunHeartbeat: touchClaimedChatRunHeartbeat,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
  beginTaskProtection: async (): Promise<void> => undefined,
  endTaskProtection: async (): Promise<void> => undefined,
};
