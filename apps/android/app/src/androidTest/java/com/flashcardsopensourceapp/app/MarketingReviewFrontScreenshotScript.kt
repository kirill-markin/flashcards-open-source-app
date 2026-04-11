package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val reviewFrontScreenshotSlug: String = "review-card-front-google-play-opportunity-cost"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewFrontScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewFrontScreenshot() {
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

        robot.prepareOpportunityCostReviewCardForReview()

        val screenshotPath = robot.saveScreenshot(fileName = reviewFrontScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(reviewFrontScreenshotFileName))
    }
}
