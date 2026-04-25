import Foundation
import XCTest

final class MarketingScreenshotsTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testCleanupMarketingGuestSession() throws {
        try self.runMarketingGuestSessionCleanupNow()
    }

    @MainActor
    func testGenerateMarketingScreenshots() throws {
        let localeFixture = try self.launchMarketingScreenshots()

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

        try self.step("open progress state") {
            try self.openMarketingProgressFromReviewBadge()
        }

        try self.step("capture progress screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.progressFileName
            )
        }

        try self.step("open review AI draft state") {
            try self.openOpportunityCostReviewCardAiDraft()
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

        try self.step("open cards list state") {
            try self.openMarketingCardsList()
        }

        try self.step("capture cards list screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.cardsFileName
            )
        }
    }
}
