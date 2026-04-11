import Foundation
import XCTest

final class MarketingReviewAiDraftScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewAiDraftScreenshot() throws {
        let localeFixture = try self.marketingLocaleFixture()

        try self.step("launch review AI draft state") {
            try self.launchMarketingApplication(
                resetState: .marketingOpportunityCostReviewCard,
                selectedTab: .review
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
            )
            try self.waitForReviewAnswerReveal()
            try self.openAiFromRevealedReviewCardAndPrepareDraft(
                draftText: localeFixture.reviewAiDraftMessage
            )
            try self.waitForAiComposerValue(
                localeFixture.reviewAiDraftMessage,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture review AI draft screenshot") {
            let screenshotURL = try self.captureMarketingScreenshot(
                fileName: localeFixture.reviewAiDraftFileName
            )
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: screenshotURL.path),
                "Expected screenshot file at \(screenshotURL.path)."
            )
        }
    }
}
