package com.flashcardsopensourceapp.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

private const val progressScreenshotSlug: String = "progress-google-play-study-history"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingProgressScreenshotScript {
    private val appStateResetRule = MarketingScreenshotAppStateResetRule()
    private val composeRule = createMarketingScreenshotComposeRule()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateStudyHistoryProgressScreenshot() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        runBlocking {
            createRepositorySeedExecutor().seedCardsAndReviewsInGuestCloudWorkspace(
                seedScenario = marketingProgressRepositorySeedScenario(
                    localeConfig = localeConfig,
                    nowMillis = System.currentTimeMillis()
                )
            )
        }
        val robot = MarketingScreenshotRobot(
            composeRule = composeRule,
            localeConfig = localeConfig
        )
        val progressScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 3,
            screenshotSlug = progressScreenshotSlug
        )

        robot.prepareStudyHistoryProgressScreen()

        val screenshotPath = robot.saveScreenshot(fileName = progressScreenshotFileName)
        val screenshotListing = robot.runShellCommand(command = "ls $screenshotPath")
        assertTrue(
            "Expected screenshot file at $screenshotPath.",
            screenshotListing.contains(progressScreenshotFileName)
        )
    }
}
