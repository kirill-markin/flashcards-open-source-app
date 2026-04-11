package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val reviewAiDraftScreenshotFileName: String =
    "en-4_review-card-ai-draft-google-play-opportunity-cost.png"
private const val reviewAiDraftMessage: String =
    "Create 6 new flashcards on the same economics topic, covering closely related ideas that are not already in this deck."

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewAiDraftScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewAiDraftScreenshot() {
        val robot = MarketingScreenshotRobot(composeRule = composeRule)

        robot.prepareOpportunityCostReviewCardForReview()
        robot.revealAnswerAndWaitForRatings()
        robot.openAiFromRevealedOpportunityCostCardAndPrepareDraft(draftText = reviewAiDraftMessage)

        val screenshotPath = robot.saveScreenshot(fileName = reviewAiDraftScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue(
            "Expected screenshot file at $screenshotPath.",
            screenshotListing.contains(reviewAiDraftScreenshotFileName)
        )
    }
}
