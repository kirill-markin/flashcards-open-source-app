package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val cardsScreenshotSlug: String = "cards-list-google-play-vocabulary"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingCardsScreenshotScript {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateConceptCardsListScreenshot() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        val robot = MarketingScreenshotRobot(
            composeRule = composeRule,
            localeConfig = localeConfig
        )
        val cardsScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 3,
            screenshotSlug = cardsScreenshotSlug
        )

        robot.waitForCardsEmptyState()
        localeConfig.cards.forEach { card ->
            robot.createCard(
                frontText = card.frontText,
                backText = card.backText,
                tags = listOf(card.subjectTag),
                effortLevel = EffortLevel.MEDIUM
            )
        }

        composeRule.waitUntil(timeoutMillis = 10_000L) {
            localeConfig.cards.all { card ->
                composeRule.onAllNodesWithText(card.frontText).fetchSemanticsNodes().isNotEmpty()
            }
        }

        val screenshotPath = robot.saveScreenshot(fileName = cardsScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(cardsScreenshotFileName))
    }
}
