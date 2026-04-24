import Foundation
import XCTest

final class MarketingReviewAndCardsScreenshotsTests: MarketingManualScreenshotTestCase {
    @MainActor
    func testGenerateOpportunityCostReviewAndCardsScreenshots() throws {
        let localeFixture = try self.launchMarketingReviewAndCards()

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

        try self.step("open cards list state") {
            try self.launchMarketingCardsList(reviewCardFrontText: localeFixture.reviewCard.frontText)
        }

        try self.step("capture cards list screenshot") {
            try self.captureMarketingScreenshotAndAssertWritten(
                fileName: localeFixture.cardsFileName
            )
        }
    }
}
