package com.flashcardsopensourceapp.app

import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4

private const val mitigateScreenshotFileName: String = "review-card-result-google-play-mitigate.png"

private const val mitigateFrontText: String =
    "What does \"mitigate\" mean in the sentence: \"New policies may help mitigate the effects of inflation\"?"

private const val mitigateBackText: String =
    "\"Mitigate\" means to make something less severe or harmful.\n\n" +
        "In this sentence, it means the policies may reduce the negative effects of inflation, " +
        "even if they do not remove the problem completely.\n\n" +
        "Example: Better planning can mitigate unnecessary stress."

@RunWith(AndroidJUnit4::class)
class MarketingReviewScreenshotTest {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun capturesMitigateReviewScreenshot() {
        val robot = MarketingScreenshotRobot(composeRule = composeRule)

        robot.waitForCardsEmptyState()
        robot.createCard(
            frontText = mitigateFrontText,
            backText = mitigateBackText,
            tags = listOf("vocabulary"),
            effortLevelTitle = "Medium"
        )
        robot.openReviewTab()
        robot.revealAnswerAndWaitForRatings()

        val screenshotPath = robot.saveScreenshot(fileName = mitigateScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(mitigateScreenshotFileName))
    }
}
