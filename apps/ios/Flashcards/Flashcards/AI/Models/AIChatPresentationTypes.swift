import Foundation

enum AIChatPresentationRequest: Hashable, Sendable {
    case createCard
    case attachCard(AIChatCardReference)
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

struct AIImportPresentationRequest: Equatable {
    let id: UUID
    let accessContext: AIChatAccessContext
    let attachments: [AIChatAttachment]
    let requestText: String

    func matches(accessContext current: AIChatAccessContext, preservedGuestLink: PreservedGuestWorkspaceLink?) -> Bool {
        if self.accessContext == current {
            return true
        }

        guard let link = preservedGuestLink,
              self.accessContext.workspaceId == link.sourceWorkspaceId,
              self.accessContext.activeWorkspaceId == nil || self.accessContext.activeWorkspaceId == link.sourceWorkspaceId,
              self.accessContext.linkedUserId == nil,
              self.accessContext.cloudState != .linked,
              self.accessContext.cloudState != .guest else {
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
