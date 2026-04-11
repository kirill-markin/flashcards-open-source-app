package com.flashcardsopensourceapp.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val reviewResultScreenshotSlug: String = "review-card-result-google-play-opportunity-cost"
private const val reviewFrontScreenshotSlug: String = "review-card-front-google-play-opportunity-cost"
private const val reviewAiDraftScreenshotSlug: String =
    "review-card-ai-draft-google-play-opportunity-cost"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createMarketingScreenshotComposeRule()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewScreenshotFlow() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        val robot = MarketingScreenshotRobot(
            composeRule = composeRule,
            localeConfig = localeConfig
        )
        val reviewFrontScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 1,
            screenshotSlug = reviewFrontScreenshotSlug
        )
        val reviewResultScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 2,
            screenshotSlug = reviewResultScreenshotSlug
        )
        val reviewAiDraftScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 4,
            screenshotSlug = reviewAiDraftScreenshotSlug
        )

        robot.prepareOpportunityCostReviewCardForReview()

        assertScreenshotSaved(
            robot = robot,
            fileName = reviewFrontScreenshotFileName
        )

        robot.revealAnswerAndWaitForRatings()
        assertScreenshotSaved(
            robot = robot,
            fileName = reviewResultScreenshotFileName
        )

        robot.openAiFromRevealedOpportunityCostCardAndPrepareDraft(
            draftText = localeConfig.reviewAiDraftMessage
        )
        assertScreenshotSaved(
            robot = robot,
            fileName = reviewAiDraftScreenshotFileName
        )
    }

    private fun assertScreenshotSaved(robot: MarketingScreenshotRobot, fileName: String) {
        val screenshotPath = robot.saveScreenshot(fileName = fileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue(
            "Expected screenshot file at $screenshotPath.",
            screenshotListing.contains(fileName)
        )
    }
}
