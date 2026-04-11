package com.flashcardsopensourceapp.app

import android.app.LocaleManager
import android.os.LocaleList
import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.feature.ai.R as AiFeatureR
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiConversationSurfaceTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewAiCardButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.Locale

private const val screenshotUiTimeoutMillis: Long = 10_000L
private const val aiScreenshotUiTimeoutMillis: Long = 30_000L
private const val aiAttachmentUiTimeoutMillis: Long = 60_000L
private const val marketingScreenshotDirectoryPath: String = "/sdcard/Download/flashcards-marketing-screenshots"

internal typealias MainActivityComposeRule =
    AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

internal class MarketingScreenshotRobot(
    private val composeRule: MainActivityComposeRule,
    private val localeConfig: MarketingScreenshotLocaleConfig
) {
    private val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var hasAppliedLocale: Boolean = false

    fun waitForCardsEmptyState() {
        ensureLocaleApplied()
        openCardsTab()
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(localeConfig.uiText.searchCardsPlaceholder).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(localeConfig.uiText.emptyCardsMessage).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun createCard(frontText: String, backText: String, tags: List<String>, effortLevelTitle: String) {
        ensureLocaleApplied()
        openCardsTab()
        clickContentDescription(contentDescription = localeConfig.uiText.addCardContentDescription)
        updateCardText(fieldTitle = localeConfig.uiText.frontFieldTitle, value = frontText)
        updateCardText(fieldTitle = localeConfig.uiText.backFieldTitle, value = backText)
        scrollToText(text = effortLevelTitle)
        clickText(text = effortLevelTitle)

        if (tags.isNotEmpty()) {
            clickText(text = localeConfig.uiText.tagsFieldTitle)
            tags.forEach { tag ->
                dismissExternalSystemDialogIfPresent()
                composeRule.onNodeWithText(localeConfig.uiText.addTagFieldTitle).performTextInput(tag)
                composeRule.waitForIdle()
                dismissExternalSystemDialogIfPresent()
                clickText(text = localeConfig.uiText.addTagButtonTitle)
            }
            tapBackIcon()
        }

        scrollToText(text = localeConfig.uiText.saveButtonTitle)
        waitForNode(
            matcher = hasClickAction().and(other = hasText(localeConfig.uiText.saveButtonTitle))
        )
        clickNode(
            matcher = hasClickAction().and(other = hasText(localeConfig.uiText.saveButtonTitle))
        )
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(localeConfig.uiText.searchCardsPlaceholder).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun openReviewTab() {
        ensureLocaleApplied()
        clickNode(
            matcher = hasText(localeConfig.uiText.reviewTabTitle).and(other = hasClickAction())
        )
    }

    fun prepareAiChatForCardHandoff() {
        val consentTitle = composeRule.activity.getString(AiFeatureR.string.ai_consent_title)
        val consentAccept = composeRule.activity.getString(AiFeatureR.string.ai_consent_accept)

        openAiTab()
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isNotEmpty() ||
                (
                    composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty() &&
                        composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes().isNotEmpty()
                    )
        }
        dismissAiConsentIfNeeded(consentTitle = consentTitle, consentAccept = consentAccept)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    fun returnToOpportunityCostReviewCard() {
        openReviewTab()
        waitForReviewPrompt(frontText = localeConfig.reviewCard.frontText)
    }

    fun prepareOpportunityCostReviewCardForReview() {
        waitForCardsEmptyState()
        createCard(
            frontText = localeConfig.reviewCard.frontText,
            backText = localeConfig.reviewCard.backText,
            tags = localeConfig.reviewCard.tags,
            effortLevelTitle = localeConfig.reviewCard.effortLevelTitle
        )
        openReviewTab()
        waitForReviewPrompt(frontText = localeConfig.reviewCard.frontText)
    }

    fun revealAnswerAndWaitForRatings() {
        ensureLocaleApplied()
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        clickTag(tag = reviewShowAnswerButtonTag)
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(localeConfig.uiText.ratingAgainTitle).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(localeConfig.uiText.ratingHardTitle).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(localeConfig.uiText.ratingGoodTitle).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(localeConfig.uiText.ratingEasyTitle).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).fetchSemanticsNode()
    }

    fun openAiFromRevealedOpportunityCostCardAndPrepareDraft(draftText: String) {
        ensureLocaleApplied()
        val consentTitle = composeRule.activity.getString(AiFeatureR.string.ai_consent_title)
        val consentAccept = composeRule.activity.getString(AiFeatureR.string.ai_consent_accept)
        val attachmentLabel = composeRule.activity.getString(
            AiFeatureR.string.ai_card_attachment_title,
            localeConfig.reviewCard.frontText
        )
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        clickTag(tag = reviewAiCardButtonTag)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isNotEmpty() ||
                (
                    composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty() &&
                        composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes().isNotEmpty()
                    )
        }
        dismissAiConsentIfNeeded(consentTitle = consentTitle, consentAccept = consentAccept)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes().isNotEmpty()
        }
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiAttachmentUiTimeoutMillis) {
            composeRule.onAllNodesWithText(attachmentLabel).fetchSemanticsNodes().isNotEmpty()
        }
        clickTag(tag = aiComposerMessageFieldTag)
        dismissExternalSystemDialogIfPresent()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(draftText)
        composeRule.waitForIdle()
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(draftText).fetchSemanticsNodes().isNotEmpty()
        }
        clearAiComposerFocus()
    }

    fun saveScreenshot(fileName: String): String {
        ensureLocaleApplied()
        dismissExternalSystemDialogIfPresent()
        composeRule.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        dismissExternalSystemDialogIfPresent()

        val screenshotPath = "$marketingScreenshotDirectoryPath/$fileName"
        runShellCommand(command = "mkdir -p $marketingScreenshotDirectoryPath")
        runShellCommand(command = "screencap -p $screenshotPath")
        return screenshotPath
    }

    private fun openCardsTab() {
        clickNode(
            matcher = hasText(localeConfig.uiText.cardsTabTitle).and(other = hasClickAction())
        )
    }

    private fun openAiTab() {
        clickNode(
            matcher = hasText(localeConfig.uiText.aiTabTitle).and(other = hasClickAction())
        )
    }

    private fun ensureLocaleApplied() {
        if (hasAppliedLocale) {
            return
        }

        val expectedLocale: Locale = Locale.forLanguageTag(localeConfig.appLocaleTag)
        composeRule.runOnUiThread {
            val localeManager = composeRule.activity.getSystemService(LocaleManager::class.java)
            localeManager.applicationLocales = LocaleList.forLanguageTags(localeConfig.appLocaleTag)
        }
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            val currentLocale = composeRule.activity.resources.configuration.locales[0]
            currentLocale.language == expectedLocale.language
        }
        composeRule.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        hasAppliedLocale = true
    }

    private fun updateCardText(fieldTitle: String, value: String) {
        clickText(text = fieldTitle)
        dismissExternalSystemDialogIfPresent()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
        tapBackIcon()
    }

    private fun tapBackIcon() {
        dismissExternalSystemDialogIfPresent()
        if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithContentDescription("Back").performClick()
            composeRule.waitForIdle()
            dismissExternalSystemDialogIfPresent()
            return
        }

        composeRule.activity.runOnUiThread {
            composeRule.activity.onBackPressedDispatcher.onBackPressed()
        }
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    private fun scrollToText(text: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
    }

    private fun waitForNode(matcher: SemanticsMatcher) {
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodes(matcher = matcher).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForReviewPrompt(frontText: String) {
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitUntilWithSystemDialogMitigation(condition: () -> Boolean) {
        waitUntilWithSystemDialogMitigation(
            timeoutMillis = screenshotUiTimeoutMillis,
            condition = condition
        )
    }

    private fun waitUntilWithSystemDialogMitigation(timeoutMillis: Long, condition: () -> Boolean) {
        dismissExternalSystemDialogIfPresent()
        composeRule.waitUntil(timeoutMillis = timeoutMillis) {
            dismissExternalSystemDialogIfPresent()
            condition()
        }
        dismissExternalSystemDialogIfPresent()
    }

    private fun dismissAiConsentIfNeeded(consentTitle: String, consentAccept: String) {
        if (composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isNotEmpty()) {
            clickText(text = consentAccept)
        }
    }

    private fun dismissExternalSystemDialogIfPresent() {
        device.dismissBlockingSystemDialogIfPresent()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }

    private fun clearAiComposerFocus() {
        dismissExternalSystemDialogIfPresent()
        if (composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithTag(aiConversationSurfaceTag).performClick()
            composeRule.waitForIdle()
        }
        dismissExternalSystemDialogIfPresent()
    }

    private fun clickNode(matcher: SemanticsMatcher) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNode(matcher = matcher).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    private fun clickText(text: String) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNodeWithText(text).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    private fun clickTag(tag: String) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNodeWithTag(tag).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    private fun clickContentDescription(contentDescription: String) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNodeWithContentDescription(contentDescription).performClick()
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    fun runShellCommand(command: String): String {
        val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
            BufferedReader(InputStreamReader(inputStream)).use { reader ->
                return reader.readText()
            }
        }
    }

}
