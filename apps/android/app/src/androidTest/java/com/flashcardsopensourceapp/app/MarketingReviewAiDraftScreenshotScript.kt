package com.flashcardsopensourceapp.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val reviewAiDraftScreenshotSlug: String =
    "review-card-ai-draft-google-play-opportunity-cost"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewAiDraftScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createMarketingScreenshotComposeRule()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewAiDraftScreenshot() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        val robot = MarketingScreenshotRobot(
            composeRule = composeRule,
            localeConfig = localeConfig
        )
        val reviewAiDraftScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 4,
            screenshotSlug = reviewAiDraftScreenshotSlug
        )

        robot.prepareOpportunityCostReviewCardForReview()
        robot.revealAnswerAndWaitForRatings()
        robot.openAiFromRevealedOpportunityCostCardAndPrepareDraft(
            draftText = localeConfig.reviewAiDraftMessage
        )

        val screenshotPath = robot.saveScreenshot(fileName = reviewAiDraftScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue(
            "Expected screenshot file at $screenshotPath.",
            screenshotListing.contains(reviewAiDraftScreenshotFileName)
        )
    }
}
