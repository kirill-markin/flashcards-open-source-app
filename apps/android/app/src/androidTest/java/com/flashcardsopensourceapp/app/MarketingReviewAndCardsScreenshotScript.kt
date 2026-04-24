package com.flashcardsopensourceapp.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
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
private const val cardsScreenshotSlug: String = "cards-list-google-play-vocabulary"

@ManualOnlyAndroidTest
@RunWith(AndroidJUnit4::class)
class MarketingReviewAndCardsScreenshotScript {
    private val appStateResetRule = MarketingScreenshotAppStateResetRule()
    private val composeRule = createMarketingScreenshotComposeRule()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun generateOpportunityCostReviewAndCardsScreenshotFlow() {
        val localeConfig = activeMarketingScreenshotLocaleConfig()
        runBlocking {
            createRepositorySeedExecutor().seedCardsAndReviewsInGuestCloudWorkspace(
                seedScenario = marketingReviewAndCardsRepositorySeedScenario(localeConfig = localeConfig)
            )
        }
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
        val cardsScreenshotFileName = marketingScreenshotFileName(
            localeConfig = localeConfig,
            screenshotIndex = 5,
            screenshotSlug = cardsScreenshotSlug
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

        robot.prepareCardsListForScreenshot(
            frontTexts = localeConfig.cards.map { card -> card.frontText },
            expectedTopFrontText = localeConfig.reviewCard.frontText
        )
        assertScreenshotSaved(
            robot = robot,
            fileName = cardsScreenshotFileName
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
