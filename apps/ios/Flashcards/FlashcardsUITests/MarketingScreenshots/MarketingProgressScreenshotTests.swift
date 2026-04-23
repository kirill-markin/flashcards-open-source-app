import Foundation
import XCTest

final class MarketingProgressScreenshotTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateStudyHistoryProgressScreenshot() throws {
        let localeFixture: MarketingScreenshotLocaleFixture = try self.launchMarketingProgress()

        try self.step("capture progress screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.progressFileName
            )
        }
    }
}
