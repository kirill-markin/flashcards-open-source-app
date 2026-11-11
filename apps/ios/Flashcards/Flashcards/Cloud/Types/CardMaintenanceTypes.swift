enum CardMaintenanceKind: String, Encodable, Hashable, Sendable {
    case resetCard
    case resetDeck
    case resetTag
    case removeTag
}

struct CardMaintenanceScope: Hashable, Sendable {
    let workspaceId: String
    let kind: CardMaintenanceKind
    let target: String
    let expectedDeckFilter: DeckFilterDefinition?
}

struct CardMaintenancePreviewRequest: Encodable, Sendable {
    let kind: CardMaintenanceKind
    let target: String
}

struct CardMaintenancePreviewResponse: Decodable, Sendable {
    let targetName: String
    let affectedCardsCount: Int
    let confirmationText: String
    let previewFingerprint: String
    let includesAllCards: Bool
    let affectedDecksCount: Int
}

struct CardMaintenanceExecuteRequest: Encodable, Sendable {
    let kind: CardMaintenanceKind
    let target: String
    let confirmationText: String
    let previewFingerprint: String
}

struct CardMaintenanceExecuteResponse: Decodable, Sendable {
    let affectedCardsCount: Int
}

struct CardMaintenanceReconcileRequest: Encodable, Sendable {
    let previewFingerprint: String
}

struct CardMaintenanceReconcileResponse: Decodable, Sendable {
    let isSettled: Bool
}

enum CardMaintenanceRefreshStatus {
    case unresolved
    case acknowledged
}

struct PendingCardMaintenanceRefresh {
    let token: String
    let previewFingerprint: String
    let status: CardMaintenanceRefreshStatus
}

struct CardMaintenancePreview: Sendable {
    let scope: CardMaintenanceScope
    let userId: String
    let apiBaseUrl: String
    let response: CardMaintenancePreviewResponse
}

enum CardMaintenanceError: Error {
    case signInRequired
    case workspaceChanged
    case targetNotFound
    case previewChanged
    case confirmationInvalid
    case deckRulesChanged
    case refreshRequired
    case executionRejected(String)
    case executionUnconfirmed(String?)

    static var refreshRequiredMessage: String {
        aiSettingsLocalized(
            "settings.workspace.cardMaintenance.refreshRequired",
            "Sync this workspace before editing or studying."
        )
    }
}
