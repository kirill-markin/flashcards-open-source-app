import Foundation
import XCTest

final class MarketingReviewFrontScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewFrontScreenshot() throws {
        try self.step("launch opportunity cost review front state") {
            try self.launchMarketingApplication(
                resetState: .marketingOpportunityCostReviewCard,
                selectedTab: .review
            )
            try self.assertTextExists(
                MarketingScreenshotFixture.opportunityCostReviewFrontText,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture review front screenshot") {
            let screenshotURL = try self.captureMarketingScreenshot(
                fileName: MarketingScreenshotFixture.reviewFrontFileName
            )
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: screenshotURL.path),
                "Expected screenshot file at \(screenshotURL.path)."
            )
        }
    }
}
