import Foundation
import XCTest

struct MarketingScreenshotCardFixture {
    let frontText: String
    let backText: String
    let subjectTag: String
}

enum MarketingScreenshotFixture {
    static let reviewFrontFileName: String = "en-1_review-card-front-app-store-opportunity-cost.png"
    static let reviewResultFileName: String = "en-2_review-card-result-app-store-opportunity-cost.png"
    static let cardsFileName: String = "en-3_cards-list-app-store-vocabulary.png"
    static let reviewAiDraftFileName: String = "en-4_review-card-ai-draft-app-store-opportunity-cost.png"

    static let opportunityCostReviewFrontText: String = "In economics, what is opportunity cost?"
    static let reviewAiDraftMessage: String = "Create 6 new flashcards on the same economics topic, covering closely related ideas that are not already in this deck."

    static let conceptCards: [MarketingScreenshotCardFixture] = [
        MarketingScreenshotCardFixture(
            frontText: "In economics, what is opportunity cost?",
            backText: "The value of the next best alternative you give up when you choose one option over another.",
            subjectTag: "economics"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In biology, what is osmosis?",
            backText: "The movement of water through a membrane from lower solute concentration to higher solute concentration.",
            subjectTag: "biology"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In statistics, what is standard deviation?",
            backText: "A measure of how spread out values are around the average.",
            subjectTag: "statistics"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In chemistry, what is a catalyst?",
            backText: "A substance that speeds up a chemical reaction without being consumed by it.",
            subjectTag: "chemistry"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In psychology, what is cognitive bias?",
            backText: "A systematic pattern of thinking that can distort judgment and decision-making.",
            subjectTag: "psychology"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In physics, what is velocity?",
            backText: "The speed of an object together with the direction of its motion.",
            subjectTag: "physics"
        ),
        MarketingScreenshotCardFixture(
            frontText: "In computer science, what is recursion?",
            backText: "A method where a function solves a problem by calling itself on smaller versions of that problem.",
            subjectTag: "computer-science"
        )
    ]
}

extension MarketingManualScreenshotTestCase {
    @MainActor
    func openAiFromRevealedReviewCardAndPrepareDraft(draftText: String) throws {
        try self.tapButton(
            identifier: LiveSmokeIdentifier.reviewAiButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()

        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.replaceAiComposerText(
            draftText,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.dismissAiComposerKeyboardIfVisible(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func dismissAiComposerKeyboardIfVisible(timeout: TimeInterval) throws {
        guard self.softwareKeyboardIsVisible() else {
            return
        }

        let dismissalSurface = self.app.otherElements[LiveSmokeIdentifier.aiScreen].firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if dismissalSurface.exists && dismissalSurface.isHittable {
                dismissalSurface.tap()
            } else {
                let coordinate = self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
                coordinate.tap()
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            if self.softwareKeyboardIsVisible() == false {
                return
            }
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI composer keyboard remained visible after dismissal attempts.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
}
