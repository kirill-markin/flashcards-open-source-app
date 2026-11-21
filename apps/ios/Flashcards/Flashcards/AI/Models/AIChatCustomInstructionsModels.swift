import Foundation

struct AIChatCustomInstructionsRoute: Hashable {}

struct AIChatCustomInstructionsScope: Hashable, Sendable {
    let userId: String
    let workspaceId: String
    let isGuest: Bool
    let syncGeneration: UUID
}

extension AIChatCustomInstructionsScope {
    init?(session: CloudLinkedSession) {
        guard let generation = session.aiRequestSyncGeneration else { return nil }
        self.init(
            userId: session.userId,
            workspaceId: session.workspaceId,
            isGuest: session.authorization.isGuest,
            syncGeneration: generation
        )
    }
}

struct AIChatCustomInstructionsReading: Hashable, Sendable {
    let scope: AIChatCustomInstructionsScope
    let text: String?
    /// A read counts from when it was sent, a save from when it completed, so a newer one always wins.
    let observedAt: ContinuousClock.Instant
}

extension AIChatCustomInstructionsReading {
    init?(session: CloudLinkedSession, text: String?, observedAt: ContinuousClock.Instant) {
        guard let scope = AIChatCustomInstructionsScope(session: session) else { return nil }
        self.init(scope: scope, text: text, observedAt: observedAt)
    }
}

struct AIChatCustomInstructionsResponse: Decodable, Equatable, Sendable {
    let customInstructions: String?
    let maxLength: Int
    let canEdit: Bool
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
