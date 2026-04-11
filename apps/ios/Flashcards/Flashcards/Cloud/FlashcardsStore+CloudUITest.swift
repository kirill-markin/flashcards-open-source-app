import Foundation

enum FlashcardsUITestResetState: String {
    case localGuest = "local_guest"
    case localGuestSeededManualReviewCard = "local_guest_seeded_manual_review_card"
    case localGuestSeededAIReviewCard = "local_guest_seeded_ai_review_card"
    case marketingOpportunityCostReviewCard = "marketing_opportunity_cost_review_card"
    case marketingConceptCards = "marketing_concept_cards"
}

private struct FlashcardsUITestSeedCard {
    let frontText: String
    let backText: String
    let tags: [String]
}

private enum FlashcardsUITestSeedData {
    static let manualReviewCard: FlashcardsUITestSeedCard = FlashcardsUITestSeedCard(
        frontText: "Smoke seeded manual review question",
        backText: "Smoke seeded manual review answer",
        tags: []
    )
    static let aiReviewCard: FlashcardsUITestSeedCard = FlashcardsUITestSeedCard(
        frontText: "Smoke seeded AI review question",
        backText: "Smoke seeded AI review answer",
        tags: ["smoke-seeded-ai-review"]
    )
}

private enum FlashcardsUITestMarketingFixtures {
    static let opportunityCostReviewCard: FlashcardsUITestSeedCard = FlashcardsUITestSeedCard(
        frontText: "In economics, what is opportunity cost?",
        backText: """
        Opportunity cost is the value of the next best alternative you give up when you choose one option over another.

        Exam example: If you spend Saturday studying for a microeconomics exam instead of working a paid shift, the lost wages are part of the opportunity cost.
        """,
        tags: ["economics"]
    )

    static let conceptCards: [FlashcardsUITestSeedCard] = [
        FlashcardsUITestSeedCard(
            frontText: "In economics, what is opportunity cost?",
            backText: "The value of the next best alternative you give up when you choose one option over another.",
            tags: ["economics"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In biology, what is osmosis?",
            backText: "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
            tags: ["biology"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In statistics, what is standard deviation?",
            backText: "A measure of how spread out values are around the average.",
            tags: ["statistics"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In chemistry, what is a catalyst?",
            backText: "A substance that speeds up a chemical reaction without being consumed by it.",
            tags: ["chemistry"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In psychology, what is cognitive bias?",
            backText: "A systematic pattern of thinking that can distort judgment and decision-making.",
            tags: ["psychology"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In physics, what is velocity?",
            backText: "The speed of an object together with the direction of its motion.",
            tags: ["physics"]
        ),
        FlashcardsUITestSeedCard(
            frontText: "In computer science, what is recursion?",
            backText: "A method where a function solves a problem by calling itself on smaller versions of that problem.",
            tags: ["computer-science"]
        )
    ]
}

@MainActor
extension FlashcardsStore {
    func applyUITestResetState(resetState: FlashcardsUITestResetState) throws {
        try self.resetLocalStateForCloudIdentityChange()

        switch resetState {
        case .localGuest:
            return
        case .localGuestSeededManualReviewCard:
            try self.seedUITestCard(card: FlashcardsUITestSeedData.manualReviewCard)
        case .localGuestSeededAIReviewCard:
            try self.seedUITestCard(card: FlashcardsUITestSeedData.aiReviewCard)
        case .marketingOpportunityCostReviewCard:
            try self.seedUITestCard(card: FlashcardsUITestMarketingFixtures.opportunityCostReviewCard)
        case .marketingConceptCards:
            try self.seedUITestCards(cards: FlashcardsUITestMarketingFixtures.conceptCards)
        }
    }

    private func seedUITestCards(cards: [FlashcardsUITestSeedCard]) throws {
        for card in cards {
            try self.seedUITestCard(card: card)
        }
    }

    private func seedUITestCard(card: FlashcardsUITestSeedCard) throws {
        try self.saveCard(
            input: CardEditorInput(
                frontText: card.frontText,
                backText: card.backText,
                tags: card.tags,
                effortLevel: .medium
            ),
            editingCardId: nil
        )
    }
}
