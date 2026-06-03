import Foundation
@testable import Flashcards


extension AIChatStoreTestSupport {
    static func makeNewSessionResponse(sessionId: String) -> AIChatNewSessionResponse {
        let chatConfigData = try! JSONEncoder().encode(aiChatDefaultServerConfig)
        let chatConfigObject = try! JSONSerialization.jsonObject(with: chatConfigData)
        let data = try! JSONSerialization.data(
            withJSONObject: [
                "ok": true,
                "sessionId": sessionId,
                "composerSuggestions": [],
                "chatConfig": chatConfigObject
            ]
        )
        return try! JSONDecoder().decode(AIChatNewSessionResponse.self, from: data)
    }

    static func makeAcceptedStartRunResponse(sessionId: String, userText: String) -> AIChatStartRunResponse {
        AIChatStartRunResponse(
            accepted: true,
            sessionId: sessionId,
            conversationScopeId: sessionId,
            conversation: AIChatConversation(
                messages: [
                    self.makeUserTextMessage(
                        id: "message-0",
                        text: userText,
                        timestamp: "2026-04-08T10:00:00Z"
                    ),
                    self.makeAssistantTextMessage(
                        id: "message-1",
                        itemId: "item-1",
                        text: "Working on it.",
                        timestamp: "2026-04-08T10:00:01Z"
                    )
                ],
                updatedAt: 1,
                mainContentInvalidationVersion: 1,
                hasOlder: false,
                oldestCursor: nil
            ),
            composerSuggestions: [],
            chatConfig: aiChatDefaultServerConfig,
            activeRun: nil,
            deduplicated: nil
        )
    }
}
