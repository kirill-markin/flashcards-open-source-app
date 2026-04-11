import Foundation
import XCTest

final class MarketingReviewAiDraftScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewAiDraftScreenshot() throws {
        try self.step("launch review AI draft state") {
            try self.launchMarketingApplication(
                resetState: .marketingOpportunityCostReviewCard,
                selectedTab: .review
            )
            try self.assertTextExists(
                MarketingScreenshotFixture.opportunityCostReviewFrontText,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
            )
            try self.waitForReviewAnswerReveal()
            try self.openAiFromRevealedReviewCardAndPrepareDraft(
                draftText: MarketingScreenshotFixture.reviewAiDraftMessage
            )
            try self.assertTextExists(
                MarketingScreenshotFixture.reviewAiDraftMessage,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture review AI draft screenshot") {
            let screenshotURL = try self.captureMarketingScreenshot(
                fileName: MarketingScreenshotFixture.reviewAiDraftFileName
            )
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: screenshotURL.path),
                "Expected screenshot file at \(screenshotURL.path)."
            )
        }
    }
}
