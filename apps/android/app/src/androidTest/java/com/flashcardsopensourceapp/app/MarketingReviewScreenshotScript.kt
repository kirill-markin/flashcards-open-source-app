package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val reviewResultScreenshotFileName: String = "en-2_review-card-result-google-play-opportunity-cost.png"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewResultScreenshot() {
        val robot = MarketingScreenshotRobot(composeRule = composeRule)

        robot.prepareOpportunityCostReviewCardForReview()
        robot.revealAnswerAndWaitForRatings()

        val screenshotPath = robot.saveScreenshot(fileName = reviewResultScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(reviewResultScreenshotFileName))
    }
}
