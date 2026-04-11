import Foundation
import XCTest

final class MarketingReviewResultScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewResultScreenshot() throws {
        let localeFixture = try self.marketingLocaleFixture()

        try self.step("launch opportunity cost review result state") {
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
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewRateGoodButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture review result screenshot") {
            let screenshotURL = try self.captureMarketingScreenshot(
                fileName: localeFixture.reviewResultFileName
            )
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: screenshotURL.path),
                "Expected screenshot file at \(screenshotURL.path)."
            )
        }
    }
}
