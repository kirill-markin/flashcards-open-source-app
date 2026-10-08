import Foundation

/// One row of `GET /chat/sessions`; `title` is null when the chat has neither a custom title nor a user message.
struct AIChatSessionHistorySummary: Decodable, Hashable, Sendable, Identifiable {
    let sessionId: String
    let title: String?
    let hasCustomTitle: Bool
    let preview: String?
    let messageCount: Int
    let createdAt: Int
    let lastActivityAt: Int

    var id: String {
        self.sessionId
    }

    var lastActivityDate: Date {
        Date(timeIntervalSince1970: TimeInterval(self.lastActivityAt) / 1_000)
    }
}

struct AIChatSessionHistoryPage: Decodable, Hashable, Sendable {
    let sessions: [AIChatSessionHistorySummary]
    let nextCursor: String?
}

struct AIChatSessionRenameRequestBody: Encodable, Hashable, Sendable {
    let title: String
}

struct AIChatArchivedSession: Decodable, Hashable, Sendable {
    let sessionId: String
    let archivedAt: Int
}
