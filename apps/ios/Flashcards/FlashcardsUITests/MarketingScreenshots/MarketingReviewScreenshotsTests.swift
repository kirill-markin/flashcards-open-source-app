import Foundation
import XCTest

final class MarketingReviewScreenshotsTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewScreenshots() throws {
        let localeFixture = try self.launchOpportunityCostReviewCard()

        try self.step("capture review front screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.reviewFrontFileName
            )
        }

        try self.step("reveal review answer") {
            try self.revealOpportunityCostReviewAnswer()
        }

        try self.step("capture review result screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.reviewResultFileName
            )
        }

        try self.step("open review AI draft state") {
            try self.launchOpportunityCostReviewCardAiHandoff()
            try self.prepareAiDraftWithCurrentAttachment(draftText: localeFixture.reviewAiDraftMessage)
            try self.waitForAiComposerValue(
                localeFixture.reviewAiDraftMessage,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
        }

        try self.step("capture review AI draft screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.reviewAiDraftFileName
            )
        }
    }
}
