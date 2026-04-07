import Foundation

enum FlashcardsUITestResetState: String {
    case localGuest = "local_guest"
    case localGuestSeededManualReviewCard = "local_guest_seeded_manual_review_card"
    case localGuestSeededAIReviewCard = "local_guest_seeded_ai_review_card"
}

private enum FlashcardsUITestSeedData {
    static let manualReviewFrontText: String = "Smoke seeded manual review question"
    static let manualReviewBackText: String = "Smoke seeded manual review answer"
    static let aiReviewFrontText: String = "Smoke seeded AI review question"
    static let aiReviewBackText: String = "Smoke seeded AI review answer"
    static let aiReviewTag: String = "smoke-seeded-ai-review"
}

@MainActor
extension FlashcardsStore {
    func applyUITestResetState(resetState: FlashcardsUITestResetState) throws {
        try self.resetLocalStateForCloudIdentityChange()

        switch resetState {
        case .localGuest:
            return
        case .localGuestSeededManualReviewCard:
            try self.seedUITestCard(
                frontText: FlashcardsUITestSeedData.manualReviewFrontText,
                backText: FlashcardsUITestSeedData.manualReviewBackText,
                tags: []
            )
        case .localGuestSeededAIReviewCard:
            try self.seedUITestCard(
                frontText: FlashcardsUITestSeedData.aiReviewFrontText,
                backText: FlashcardsUITestSeedData.aiReviewBackText,
                tags: [FlashcardsUITestSeedData.aiReviewTag]
            )
        }
    }

    private func seedUITestCard(frontText: String, backText: String, tags: [String]) throws {
        try self.saveCard(
            input: CardEditorInput(
                frontText: frontText,
                backText: backText,
                tags: tags,
                effortLevel: .medium
            ),
            editingCardId: nil
        )
    }
}
