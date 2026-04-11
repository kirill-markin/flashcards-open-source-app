import Foundation
import XCTest

final class MarketingCardsScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateConceptCardsListScreenshot() throws {
        let localeFixture = try self.marketingLocaleFixture()

        try self.step("launch marketing cards list state") {
            try self.launchMarketingApplication(
                resetState: .marketingConceptCards,
                selectedTab: .cards,
                aiHandoffCard: nil
            )
            try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsCardRow,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsCardRow,
                index: 1,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture cards list screenshot") {
            let screenshotURL = try self.captureMarketingScreenshot(
                fileName: localeFixture.cardsFileName
            )
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: screenshotURL.path),
                "Expected screenshot file at \(screenshotURL.path)."
            )
        }
    }
}
