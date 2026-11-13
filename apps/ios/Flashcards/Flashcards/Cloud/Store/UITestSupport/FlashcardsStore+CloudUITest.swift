import Foundation

private let marketingScreenshotLocalizationEnvironmentKey: String = "FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION"

enum FlashcardsUITestLaunchScenario: String {
    case guestEmptyWorkspace = "guest_empty_workspace"
    case guestManualReviewCard = "guest_manual_review_card"
    case guestAIReviewCard = "guest_ai_review_card"
    #if targetEnvironment(macCatalyst)
    case guestRichReviewCard = "guest_rich_review_card"
    #endif
    case marketingScreenshots = "marketing_screenshots"
    case marketingGuestSessionCleanup = "marketing_guest_session_cleanup"

    var requiresGuestCloudBootstrap: Bool {
        switch self {
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestAIReviewCard:
            return false
        #if targetEnvironment(macCatalyst)
        case .guestRichReviewCard:
            return false
        #endif
        case .marketingScreenshots:
            return true
        case .marketingGuestSessionCleanup:
            return false
        }
    }

    var requiresStoredGuestRemoteCleanup: Bool {
        switch self {
        case .marketingScreenshots, .marketingGuestSessionCleanup:
            return true
        case .guestEmptyWorkspace, .guestManualReviewCard, .guestAIReviewCard:
            return false
        #if targetEnvironment(macCatalyst)
        case .guestRichReviewCard:
            return false
        #endif
        }
    }
}

enum FlashcardsUITestLaunchPreparationStatus: Equatable {
    case hidden
    case running(launchScenario: FlashcardsUITestLaunchScenario)
    case ready(launchScenario: FlashcardsUITestLaunchScenario)
    case failed(launchScenario: FlashcardsUITestLaunchScenario, message: String)

    var accessibilityValue: String? {
        switch self {
        case .hidden:
            return nil
        case .running(let launchScenario):
            return "state=running;launchScenario=\(launchScenario.rawValue)"
        case .ready(let launchScenario):
            return "state=ready;launchScenario=\(launchScenario.rawValue)"
        case .failed(let launchScenario, let message):
            let sanitizedMessage = message
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return "state=failed;launchScenario=\(launchScenario.rawValue);message=\(sanitizedMessage)"
        }
    }
}

private struct FlashcardsUITestMarketingReviewHistorySeed {
    let supportCardIndex: Int
    let reviewedAtDayOffset: Int
    let rating: ReviewRating
}

private enum FlashcardsUITestLaunchScenarioData {
    #if targetEnvironment(macCatalyst)
    static let richReviewCard = CardEditorInput(
        frontText: "Mac rich review smoke",
        backText: """
        The answer is three quarters.

        ![Public icon](https://raw.githubusercontent.com/kirill-markin/flashcards-open-source-app/cecb4a5448ec7eb889aa0c0770dcf3ac064e1b9b/apps/ios/Flashcards/Flashcards/Assets.xcassets/GoogleSignInG.imageset/google-g@3x.png?release-check=652-standalone)

        | Term | Image |
        | --- | --- |
        | Public icon | ![Icon](https://raw.githubusercontent.com/kirill-markin/flashcards-open-source-app/cecb4a5448ec7eb889aa0c0770dcf3ac064e1b9b/apps/ios/Flashcards/Flashcards/Assets.xcassets/GoogleSignInG.imageset/google-g@3x.png?release-check=652-table) |
        """,
        tags: []
    )
    #endif
    static let manualReviewCard: CardEditorInput = CardEditorInput(
        frontText: "Smoke guest manual review question",
        backText: "Smoke guest manual review answer",
        tags: []
    )
    static let aiReviewCard: CardEditorInput = CardEditorInput(
        frontText: "Smoke guest AI review question",
        backText: "Smoke guest AI review answer",
        tags: [
            "smoke-guest-ai-review",
            "smoke-overflow-01",
            "smoke-overflow-02",
            "smoke-overflow-03",
            "smoke-overflow-04",
            "smoke-overflow-05",
            "smoke-overflow-06",
            "smoke-overflow-07",
            "smoke-overflow-08",
            "smoke-overflow-09",
            "smoke-overflow-10",
            "smoke-overflow-11",
            "smoke-overflow-12"
        ]
    )
}

private enum FlashcardsUITestMarketingReviewHistorySeedError: LocalizedError {
    case reviewedAtDateCreationFailed(dayOffset: Int)

    var errorDescription: String? {
        switch self {
        case .reviewedAtDateCreationFailed(let dayOffset):
            return "Failed to create marketing screenshot review timestamp for day offset \(dayOffset)."
        }
    }
}

private enum FlashcardsUITestLaunchScenarioError: LocalizedError {
    case createdCardCountMismatch(expected: Int, actual: Int)
    case missingMarketingCardsFixture(localizationCode: String)
    case insufficientMarketingReviewHistoryCards(localizationCode: String, required: Int, actual: Int)
    case marketingReviewCardPromptMismatch(localizationCode: String, reviewPrompt: String, cardsPrompt: String)

    var errorDescription: String? {
        switch self {
        case .createdCardCountMismatch(let expected, let actual):
            return "Expected \(expected) UI test cards but created \(actual)."
        case .missingMarketingCardsFixture(let localizationCode):
            return "Marketing screenshots require at least one cards fixture for localization '\(localizationCode)'."
        case .insufficientMarketingReviewHistoryCards(let localizationCode, let required, let actual):
            return "Marketing screenshots require at least \(required) support cards for localization '\(localizationCode)', but found \(actual)."
        case .marketingReviewCardPromptMismatch(let localizationCode, let reviewPrompt, let cardsPrompt):
            return "Marketing screenshots require the review prompt and first cards-list prompt to match for localization '\(localizationCode)'. reviewPrompt='\(reviewPrompt)' cardsPrompt='\(cardsPrompt)'."
        }
    }
}

private enum FlashcardsUITestMarketingFixtureError: LocalizedError {
    case missingEnvironmentValue(String)
    case unsupportedLocalization(String)

    var errorDescription: String? {
        switch self {
        case .missingEnvironmentValue(let key):
            return "Missing iOS marketing screenshot localization environment value '\(key)'."
        case .unsupportedLocalization(let value):
            let supportedValues = MarketingScreenshotFixtureCatalog.supportedLocalizationCodes.joined(separator: ", ")
            return "Unsupported iOS marketing screenshot localization '\(value)'. Supported values: \(supportedValues)."
        }
    }
}

@MainActor
extension FlashcardsStore {
    func applyUITestLaunchScenarioContent(
        launchScenario: FlashcardsUITestLaunchScenario,
        processInfo: ProcessInfo
    ) throws {
        let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
        switch launchScenario {
        case .guestEmptyWorkspace:
            return
        case .guestManualReviewCard:
            try self.createUITestCard(input: FlashcardsUITestLaunchScenarioData.manualReviewCard, context: context)
        case .guestAIReviewCard:
            try self.createUITestCard(input: FlashcardsUITestLaunchScenarioData.aiReviewCard, context: context)
        #if targetEnvironment(macCatalyst)
        case .guestRichReviewCard:
            try self.createUITestCard(input: FlashcardsUITestLaunchScenarioData.richReviewCard, context: context)
        #endif
        case .marketingScreenshots:
            let localeFixture = try self.marketingScreenshotLocaleFixture(processInfo: processInfo)
            try self.createUITestMarketingScreenshotsData(localeFixture: localeFixture, context: context)
        case .marketingGuestSessionCleanup:
            return
        }
    }

    private func marketingScreenshotLocaleFixture(processInfo: ProcessInfo) throws -> MarketingScreenshotLocaleCards {
        guard let rawValue = processInfo.environment[marketingScreenshotLocalizationEnvironmentKey] else {
            throw FlashcardsUITestMarketingFixtureError.missingEnvironmentValue(marketingScreenshotLocalizationEnvironmentKey)
        }

        let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedValue.isEmpty == false else {
            throw FlashcardsUITestMarketingFixtureError.missingEnvironmentValue(marketingScreenshotLocalizationEnvironmentKey)
        }

        guard let localeFixture = MarketingScreenshotFixtureCatalog.localeFixture(localizationCode: trimmedValue) else {
            throw FlashcardsUITestMarketingFixtureError.unsupportedLocalization(trimmedValue)
        }

        return localeFixture
    }

    private func createUITestMarketingScreenshotsData(
        localeFixture: MarketingScreenshotLocaleCards,
        context: LocalMutationContext
    ) throws {
        guard let firstConceptCard = localeFixture.conceptCards.first else {
            throw FlashcardsUITestLaunchScenarioError.missingMarketingCardsFixture(
                localizationCode: localeFixture.localizationCode
            )
        }

        guard firstConceptCard.frontText == localeFixture.reviewCard.frontText else {
            throw FlashcardsUITestLaunchScenarioError.marketingReviewCardPromptMismatch(
                localizationCode: localeFixture.localizationCode,
                reviewPrompt: localeFixture.reviewCard.frontText,
                cardsPrompt: firstConceptCard.frontText
            )
        }

        let remainingConceptCards = Array(localeFixture.conceptCards.dropFirst())
        let requiredSupportCardCount = 6
        guard remainingConceptCards.count >= requiredSupportCardCount else {
            throw FlashcardsUITestLaunchScenarioError.insufficientMarketingReviewHistoryCards(
                localizationCode: localeFixture.localizationCode,
                required: requiredSupportCardCount,
                actual: remainingConceptCards.count
            )
        }
        let createdSupportCards = try self.createUITestCards(cards: remainingConceptCards, context: context)
        try self.applyUITestMarketingReviewHistory(
            supportCards: createdSupportCards,
            localizationCode: localeFixture.localizationCode,
            context: context
        )

        let reviewCard = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: self.cardEditorInput(card: localeFixture.reviewCard),
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
        let cardsSnapshot = try context.database.cardStore.loadCardsListSnapshot(
            workspaceId: context.workspaceId,
            searchText: "",
            filter: nil
        )
        guard let newestCard = cardsSnapshot.cards.first,
              let latestUpdatedAt = parseIsoTimestamp(value: newestCard.updatedAt) else {
            throw LocalStoreError.validation("Marketing cards require a valid latest updatedAt timestamp")
        }

        // Millisecond ties fall back to random card IDs. Give the review fixture a
        // distinct local timestamp; guest bootstrap preserves these local rows.
        try context.database.core.execute(
            sql: "UPDATE cards SET updated_at = ? WHERE workspace_id = ? AND card_id = ?",
            values: [
                .text(formatIsoTimestamp(date: latestUpdatedAt.addingTimeInterval(1))),
                .text(context.workspaceId),
                .text(reviewCard.cardId)
            ]
        )
    }

    private func createUITestCards(
        cards: [MarketingScreenshotCardFixture],
        context: LocalMutationContext
    ) throws -> [Card] {
        let inputs = cards.map { card in
            self.cardEditorInput(card: card)
        }
        return try context.database.createCards(workspaceId: context.workspaceId, inputs: inputs)
    }

    private func createUITestCard(
        input: CardEditorInput,
        context: LocalMutationContext
    ) throws {
        _ = try context.database.saveCard(
            workspaceId: context.workspaceId,
            input: input,
            cardId: nil,
            mediaAssetIdsReadyForUpload: []
        )
    }

    private func applyUITestMarketingReviewHistory(
        supportCards: [Card],
        localizationCode: String,
        context: LocalMutationContext
    ) throws {
        let reviewSeeds = try self.marketingReviewHistorySeeds(
            localizationCode: localizationCode,
            supportCardCount: supportCards.count
        )
        let now: Date = Date()
        let calendar: Calendar = Calendar.current

        for reviewSeed in reviewSeeds {
            let card = supportCards[reviewSeed.supportCardIndex]
            let reviewedAtClient: String = try self.marketingReviewHistoryReviewedAtClient(
                dayOffset: reviewSeed.reviewedAtDayOffset,
                now: now,
                calendar: calendar
            )
            _ = try context.database.submitReview(
                workspaceId: context.workspaceId,
                reviewSubmission: ReviewSubmission(
                    cardId: card.cardId,
                    rating: reviewSeed.rating,
                    reviewedAtClient: reviewedAtClient,
                    reviewedTimeZone: TimeZone.current.identifier
                )
            )
        }
    }

    private func marketingReviewHistorySeeds(
        localizationCode: String,
        supportCardCount: Int
    ) throws -> [FlashcardsUITestMarketingReviewHistorySeed] {
        let requiredSupportCardCount = 6
        guard supportCardCount >= requiredSupportCardCount else {
            throw FlashcardsUITestLaunchScenarioError.insufficientMarketingReviewHistoryCards(
                localizationCode: localizationCode,
                required: requiredSupportCardCount,
                actual: supportCardCount
            )
        }

        return [
            // Canonical 30-day-ish pattern with gaps, 16 active days, and a freeze-aware 12-day streak ending today.
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -29, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -26, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -22, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -19, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -16, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -13, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -11, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -9, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: -7, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: -6, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: -5, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: -4, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 4, reviewedAtDayOffset: -3, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: -2, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: -1, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 0, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 1, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 2, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 3, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 4, reviewedAtDayOffset: 0, rating: .easy),
            FlashcardsUITestMarketingReviewHistorySeed(supportCardIndex: 5, reviewedAtDayOffset: 0, rating: .easy)
        ]
    }

    private func marketingReviewHistoryReviewedAtClient(
        dayOffset: Int,
        now: Date,
        calendar: Calendar
    ) throws -> String {
        let startOfToday = calendar.startOfDay(for: now)
        guard let todayNoon: Date = calendar.date(
            byAdding: .hour,
            value: 12,
            to: startOfToday
        ),
            let reviewedAt: Date = calendar.date(
                byAdding: .day,
                value: dayOffset,
                to: todayNoon,
                wrappingComponents: false
            ) else {
            throw FlashcardsUITestMarketingReviewHistorySeedError.reviewedAtDateCreationFailed(dayOffset: dayOffset)
        }

        return formatIsoTimestamp(date: reviewedAt)
    }

    private func cardEditorInput(card: MarketingScreenshotCardFixture) -> CardEditorInput {
        CardEditorInput(
            frontText: card.frontText,
            backText: card.backText,
            tags: card.tags
        )
    }
}
