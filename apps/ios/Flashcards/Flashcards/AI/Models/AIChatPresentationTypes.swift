import Foundation

enum AIChatPresentationRequest: Hashable, Sendable {
    case createCard
    case createCatalogDeck(AICatalogDeckPresentationRequest)
    case attachCard(AIChatCardReference)
}

struct AICatalogDeckPresentationRequest: Hashable, Sendable {
    let id: UUID
    let prompt: String
    let sceneID: String?
    let accessContext: AICatalogDeckAccessContext
}

struct AICatalogDeckAccessContext: Hashable, Sendable {
    let chatAccess: AIChatAccessContext
    let cloudServerIdentityRevision: UUID

    func matches(current: Self, preservedGuestLink: PreservedGuestWorkspaceLink?) -> Bool {
        self.cloudServerIdentityRevision == current.cloudServerIdentityRevision
            && self.chatAccess.matches(current: current.chatAccess, preservedGuestLink: preservedGuestLink)
    }
}

enum AIChatCatalogDraftBlocker: Equatable {
    case consent
    case loadingChat
    case chatUnavailable
    case run
    case retryLiveReconciliation
    case syncingRun
    case retryRunSync
    case attachmentTransfer
    case dictation
    case draft
}

func aiImportWorkspaceChangedMessage() -> String {
    aiSettingsLocalized(
        "settings.workspace.import.anki.workspaceChanged",
        "The workspace or account changed. Go back to Library and start the import again."
    )
}

func aiImportWaitingMessage() -> String {
    aiSettingsLocalized("settings.workspace.import.aiImport.waiting", "Waiting to start import…")
}

enum AIImportOpenResult {
    case opened
    case catalogRequestPending
    case importRequestPending
}

struct AIImportPresentationRequest: Equatable {
    let id: UUID
    let accessContext: AIChatAccessContext
    let attachments: [AIChatAttachment]
    let requestText: String
}

extension AIChatAccessContext {
    func matches(current: AIChatAccessContext, preservedGuestLink: PreservedGuestWorkspaceLink?) -> Bool {
        if self == current {
            return true
        }

        guard let link = preservedGuestLink,
              self.workspaceId == link.sourceWorkspaceId,
              self.activeWorkspaceId == nil || self.activeWorkspaceId == link.sourceWorkspaceId,
              self.linkedUserId == nil,
              self.cloudState != .linked,
              self.cloudState != .guest else {
            return false
        }

        return current == AIChatAccessContext(
            workspaceId: link.targetWorkspaceId,
            cloudState: .guest,
            linkedUserId: link.userId,
            activeWorkspaceId: link.targetWorkspaceId
        )
    }
}

struct AIChatCardReference: Hashable, Sendable {
    let cardId: String
    let frontText: String
    let backText: String
    let tags: [String]
}

func makeAIChatCardReference(card: Card) -> AIChatCardReference {
    AIChatCardReference(
        cardId: card.cardId,
        frontText: card.frontText,
        backText: card.backText,
        tags: card.tags
    )
}
