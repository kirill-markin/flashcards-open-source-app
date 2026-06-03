@testable import Flashcards


extension AIChatStoreTestSupport {
    static func makeConversationEnvelope(
        messages: [AIChatMessage],
        activeRun: AIChatActiveRun?
    ) -> AIChatConversationEnvelope {
        self.makeConversationEnvelope(
            sessionId: "session-1",
            messages: messages,
            activeRun: activeRun
        )
    }

    static func makeConversationEnvelope(
        sessionId: String,
        messages: [AIChatMessage],
        activeRun: AIChatActiveRun?
    ) -> AIChatConversationEnvelope {
        AIChatConversationEnvelope(
            sessionId: sessionId,
            conversationScopeId: sessionId,
            conversation: AIChatConversation(
                messages: messages,
                updatedAt: 1,
                mainContentInvalidationVersion: 1,
                hasOlder: false,
                oldestCursor: nil
            ),
            composerSuggestions: [],
            chatConfig: aiChatDefaultServerConfig,
            activeRun: activeRun
        )
    }

    static func makeActiveRun() -> AIChatActiveRun {
        AIChatActiveRun(
            runId: "run-1",
            status: "running",
            live: AIChatActiveRunLive(
                cursor: "cursor-1",
                stream: AIChatLiveStreamEnvelope(
                    url: "https://example.com/live",
                    authorization: "Bearer token",
                    expiresAt: 1
                )
            ),
            lastHeartbeatAt: nil
        )
    }

    static func makeAssistantToolCallMessage(toolCallStatus: AIChatToolCallStatus) -> AIChatMessage {
        AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [
                .toolCall(
                    AIChatToolCall(
                        id: "tool-1",
                        name: "sql",
                        status: toolCallStatus,
                        input: "{\"query\":\"select 1\"}",
                        output: nil
                    )
                )
            ],
            timestamp: "2026-04-08T10:00:00Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-1",
            itemId: "item-1"
        )
    }

    static func makeAssistantTextMessage(itemId: String) -> AIChatMessage {
        AIChatMessage(
            id: "message-1",
            role: .assistant,
            content: [.text("Working on it.")],
            timestamp: "2026-04-08T10:00:00Z",
            isError: false,
            isStopped: false,
            cursor: "cursor-1",
            itemId: itemId
        )
    }

    static func makeUserTextMessage(id: String, text: String, timestamp: String) -> AIChatMessage {
        AIChatMessage(
            id: id,
            role: .user,
            content: [.text(text)],
            timestamp: timestamp,
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
    }

    static func makeAssistantTextMessage(
        id: String,
        itemId: String,
        text: String,
        timestamp: String
    ) -> AIChatMessage {
        AIChatMessage(
            id: id,
            role: .assistant,
            content: [.text(text)],
            timestamp: timestamp,
            isError: false,
            isStopped: false,
            cursor: "cursor-\(id)",
            itemId: itemId
        )
    }

}
