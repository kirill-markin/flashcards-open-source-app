import Foundation

struct AIChatCustomInstructionsRoute: Hashable {}

struct AIChatCustomInstructionsScope: Hashable, Sendable {
    let userId: String
    let workspaceId: String
}

/// One server answer about a workspace's custom instructions, for the account and workspace it was asked for.
struct AIChatCustomInstructionsReading: Hashable, Sendable {
    let scope: AIChatCustomInstructionsScope
    let text: String?
    /// A read counts from when it was sent, a save from when it completed, so a newer one always wins.
    let observedAt: ContinuousClock.Instant

    init(session: CloudLinkedSession, text: String?, observedAt: ContinuousClock.Instant) {
        self.scope = AIChatCustomInstructionsScope(userId: session.userId, workspaceId: session.workspaceId)
        self.text = text
        self.observedAt = observedAt
    }
}

struct AIChatCustomInstructionsResponse: Decodable, Sendable {
    let customInstructions: String?
    let maxLength: Int
}

struct AIChatCustomInstructionsRequestBody: Encodable, Sendable {
    let customInstructions: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Null clears, so it is sent explicitly instead of being omitted.
        try container.encode(self.customInstructions, forKey: .customInstructions)
    }

    private enum CodingKeys: String, CodingKey {
        case customInstructions
    }
}
