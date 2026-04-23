package com.flashcardsopensourceapp.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
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
    private val appStateResetRule = MarketingScreenshotAppStateResetRule()
    private val composeRule = createMarketingScreenshotComposeRule()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateConceptCardsListScreenshot() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        runBlocking {
            createRepositorySeedExecutor().seedCardsAndReviewsInGuestCloudWorkspace(
                seedScenario = marketingCardsRepositorySeedScenario(localeConfig = localeConfig)
            )
        }
        val robot = MarketingScreenshotRobot(
            composeRule = composeRule,
            localeConfig = localeConfig
        )
        val cardsScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 5,
            screenshotSlug = cardsScreenshotSlug
        )

        robot.waitForRepositorySeededCards(frontTexts = localeConfig.cards.map { card -> card.frontText })

        val screenshotPath = robot.saveScreenshot(fileName = cardsScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue("Expected screenshot file at $screenshotPath.", screenshotListing.contains(cardsScreenshotFileName))
    }
}
