package com.flashcardsopensourceapp.app.marketing.screenshots

import android.app.LocaleManager
import android.os.LocaleList
import android.os.ParcelFileDescriptor
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.MainActivity
import com.flashcardsopensourceapp.app.livesmoke.dismissBlockingSystemDialogIfPresent
import com.flashcardsopensourceapp.app.navigation.AiDestination
import com.flashcardsopensourceapp.app.navigation.CardsDestination
import com.flashcardsopensourceapp.app.navigation.ProgressDestination
import com.flashcardsopensourceapp.app.navigation.ReviewDestination
import com.flashcardsopensourceapp.feature.ai.R as AiFeatureR
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerPendingAttachmentTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiConversationSurfaceTag
import com.flashcardsopensourceapp.feature.cards.cardsCardFrontTextTag
import com.flashcardsopensourceapp.feature.cards.cardsSearchFieldTag
import com.flashcardsopensourceapp.feature.progress.progressReviewsActivityChartTag
import com.flashcardsopensourceapp.feature.progress.progressReviewsSectionTag
import com.flashcardsopensourceapp.feature.progress.progressStreakSectionTag
import com.flashcardsopensourceapp.feature.progress.R as ProgressFeatureR
import com.flashcardsopensourceapp.feature.review.reviewRateAgainButtonTag
import com.flashcardsopensourceapp.feature.review.reviewRateEasyButtonTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewRateHardButtonTag
import com.flashcardsopensourceapp.feature.review.reviewAiCardButtonTag
import com.flashcardsopensourceapp.feature.review.reviewProgressBadgeTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import com.flashcardsopensourceapp.feature.review.R as ReviewFeatureR
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.Locale
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

private const val screenshotUiTimeoutMillis: Long = 10_000L
private const val aiScreenshotUiTimeoutMillis: Long = 30_000L
private const val aiAttachmentUiTimeoutMillis: Long = 60_000L
private const val progressScreenshotUiTimeoutMillis: Long = 30_000L
private const val marketingScreenshotDirectoryPath: String = "/sdcard/Download/flashcards-marketing-screenshots"

internal typealias MainActivityComposeRule =
    AndroidComposeTestRule<DeferredActivityScenarioRule<MainActivity>, MainActivity>

internal class DeferredActivityScenarioRule<A : ComponentActivity>(
    private val activityClass: Class<A>
) : TestRule {
    private var scenario: ActivityScenario<A>? = null

    override fun apply(base: Statement, description: Description): Statement {
        return object : Statement() {
            override fun evaluate() {
                try {
                    base.evaluate()
                } finally {
                    scenario?.close()
                    scenario = null
                }
            }
        }
    }

    fun launchActivityIfNeeded() {
        if (scenario != null) {
            return
        }

        scenario = ActivityScenario.launch(activityClass)
    }

    fun requireActivity(): A {
        val activeScenario = scenario
            ?: throw IllegalStateException("Activity ${activityClass.simpleName} was not launched.")
        var activity: A? = null
        activeScenario.onActivity { launchedActivity ->
            activity = launchedActivity
        }
        return activity
            ?: throw IllegalStateException("Activity ${activityClass.simpleName} was unavailable.")
    }
}

internal fun createMarketingScreenshotComposeRule(): MainActivityComposeRule {
    val activityRule = DeferredActivityScenarioRule(activityClass = MainActivity::class.java)
    return AndroidComposeTestRule(
        activityRule = activityRule,
        activityProvider = { rule -> rule.requireActivity() }
    )
}

internal class MarketingScreenshotRobot(
    private val composeRule: MainActivityComposeRule,
    private val localeConfig: MarketingScreenshotLocaleConfig
) {
    private val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var hasAppliedLocale: Boolean = false

    fun prepareCardsListForScreenshot() {
        ensureLocaleApplied()
        openCardsTab()
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithTag(cardsSearchFieldTag).fetchSemanticsNodes().isNotEmpty() &&
                visibleCardsFrontTexts().isNotEmpty()
        }
    }

    fun openReviewTab() {
        ensureLocaleApplied()
        clickTag(tag = ReviewDestination.testTag)
    }

    fun prepareAiChatForCardHandoff() {
        val consentTitle = composeRule.activity.getString(AiFeatureR.string.ai_consent_title)
        val consentAccept = composeRule.activity.getString(AiFeatureR.string.ai_consent_accept)

        openAiTab()
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isNotEmpty() ||
                (
                    countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                        countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
                    )
        }
        dismissAiConsentIfNeeded(consentTitle = consentTitle, consentAccept = consentAccept)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
        }
    }

    fun returnToOpportunityCostReviewCard() {
        openReviewTab()
        waitForReviewPrompt(frontText = localeConfig.reviewCard.frontText)
    }

    fun prepareOpportunityCostReviewCardForReview(
        expectedReviewStreakDays: Int,
        expectedReviewedToday: Boolean
    ) {
        openReviewTab()
        waitForReviewPrompt(frontText = localeConfig.reviewCard.frontText)
        waitForReviewProgressBadge(
            expectedReviewStreakDays = expectedReviewStreakDays,
            expectedReviewedToday = expectedReviewedToday
        )
    }

    fun revealAnswerAndWaitForRatings() {
        ensureLocaleApplied()
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        clickTag(tag = reviewShowAnswerButtonTag)
        waitForRevealedReviewCard()
    }

    fun prepareOpportunityCostReviewCardForAiHandoff() {
        openReviewTab()
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(localeConfig.reviewCard.frontText).fetchSemanticsNodes().isNotEmpty() &&
                (
                    composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty() ||
                        composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                    )
        }
        if (composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty()) {
            return
        }

        clickTag(tag = reviewShowAnswerButtonTag)
        waitForRevealedReviewCard()
    }

    fun prepareStudyHistoryProgressScreen(
        expectedProgressStreakDays: Int,
        expectedReviewedToday: Boolean
    ) {
        openProgressTab()
        waitForLoadedProgressWithReviewActivity()
        waitForProgressStreakSummary(
            expectedProgressStreakDays = expectedProgressStreakDays,
            expectedReviewedToday = expectedReviewedToday
        )
    }

    fun openAiFromRevealedOpportunityCostCardAndPrepareDraft(draftText: String) {
        ensureLocaleApplied()
        val consentTitle = composeRule.activity.getString(AiFeatureR.string.ai_consent_title)
        val consentAccept = composeRule.activity.getString(AiFeatureR.string.ai_consent_accept)
        val sendLabel = composeRule.activity.getString(AiFeatureR.string.ai_send)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        clickTag(tag = reviewAiCardButtonTag)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isNotEmpty() ||
                (
                    countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                        countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
                    )
        }
        dismissAiConsentIfNeeded(consentTitle = consentTitle, consentAccept = consentAccept)
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
        }
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiAttachmentUiTimeoutMillis) {
            countNodesWithTagInAnySemanticsTree(tag = aiComposerPendingAttachmentTag) > 0
        }
        waitForAiComposerCardHandoffState(sendLabel = sendLabel)
        fillAiComposerDraft(draftText = draftText)
        clearAiComposerFocus()
    }

    fun saveScreenshot(fileName: String): String {
        ensureLocaleApplied()
        dismissExternalSystemDialogIfPresent()
        composeRule.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        collapseStatusBar()
        dismissExternalSystemDialogIfPresent()

        val screenshotPath = "$marketingScreenshotDirectoryPath/$fileName"
        runShellCommand(command = "mkdir -p $marketingScreenshotDirectoryPath")
        runShellCommand(command = "screencap -p $screenshotPath")
        return screenshotPath
    }

    private fun collapseStatusBar() {
        runShellCommand(command = "cmd statusbar collapse")
        device.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }

    private fun openCardsTab() {
        clickTag(tag = CardsDestination.testTag)
    }

    private fun openAiTab() {
        clickTag(tag = AiDestination.testTag)
    }

    private fun openProgressTab() {
        clickTag(tag = ProgressDestination.testTag)
    }

    private fun ensureLocaleApplied() {
        composeRule.activityRule.launchActivityIfNeeded()
        if (hasAppliedLocale) {
            return
        }

        val expectedLocale: Locale = Locale.forLanguageTag(localeConfig.appLocaleTag)
        val currentLocale = composeRule.activity.resources.configuration.locales[0]
        if (currentLocale.toLanguageTag() == expectedLocale.toLanguageTag()) {
            hasAppliedLocale = true
            return
        }

        composeRule.runOnUiThread {
            val localeManager = composeRule.activity.getSystemService(LocaleManager::class.java)
            localeManager.applicationLocales = LocaleList.forLanguageTags(localeConfig.appLocaleTag)
        }
        composeRule.waitUntil(timeoutMillis = screenshotUiTimeoutMillis) {
            val currentLocale = composeRule.activity.resources.configuration.locales[0]
            currentLocale.toLanguageTag() == expectedLocale.toLanguageTag()
        }
        composeRule.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        hasAppliedLocale = true
    }

    private fun waitForNode(matcher: SemanticsMatcher) {
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodes(matcher = matcher).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun scrollToNode(matcher: SemanticsMatcher) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher)
        composeRule.waitForIdle()
        dismissExternalSystemDialogIfPresent()
    }

    private fun waitForReviewPrompt(frontText: String) {
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForLoadedProgressWithReviewActivity() {
        waitUntilWithSystemDialogMitigation(timeoutMillis = progressScreenshotUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(progressStreakSectionTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(progressReviewsSectionTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(progressReviewsActivityChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForReviewProgressBadge(
        expectedReviewStreakDays: Int,
        expectedReviewedToday: Boolean
    ) {
        val expectedContentDescription = composeRule.activity.resources.getQuantityString(
            ReviewFeatureR.plurals.review_progress_badge_content_description,
            expectedReviewStreakDays,
            expectedReviewStreakDays
        )
        val expectedStateDescription = composeRule.activity.getString(
            if (expectedReviewedToday) {
                ReviewFeatureR.string.review_progress_badge_reviewed_today
            } else {
                ReviewFeatureR.string.review_progress_badge_not_reviewed_today
            }
        )
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithTag(reviewProgressBadgeTag)
                .fetchSemanticsNodes()
                .singleOrNull()
                ?.config
                ?.let { config ->
                    config.getOrNull(SemanticsProperties.ContentDescription) ==
                        listOf(expectedContentDescription) &&
                        config.getOrNull(SemanticsProperties.StateDescription) == expectedStateDescription
                } == true
        }
    }

    private fun waitForRevealedReviewCard() {
        waitUntilWithSystemDialogMitigation {
            composeRule.onAllNodesWithTag(reviewRateAgainButtonTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewRateHardButtonTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewRateGoodButtonTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewRateEasyButtonTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).fetchSemanticsNode()
    }

    private fun waitForProgressStreakSummary(
        expectedProgressStreakDays: Int,
        expectedReviewedToday: Boolean
    ) {
        val expectedContentDescription = composeRule.activity.resources.getQuantityString(
            ProgressFeatureR.plurals.progress_streak_summary_content_description,
            expectedProgressStreakDays,
            expectedProgressStreakDays
        )
        val expectedStateDescription = composeRule.activity.getString(
            if (expectedReviewedToday) {
                ProgressFeatureR.string.progress_streak_summary_reviewed_today
            } else {
                ProgressFeatureR.string.progress_streak_summary_not_reviewed_today
            }
        )
        waitUntilWithSystemDialogMitigation(timeoutMillis = progressScreenshotUiTimeoutMillis) {
            hasSemanticsNodeWithDescriptions(
                expectedContentDescription = expectedContentDescription,
                expectedStateDescription = expectedStateDescription,
                useUnmergedTree = false
            ) || hasSemanticsNodeWithDescriptions(
                expectedContentDescription = expectedContentDescription,
                expectedStateDescription = expectedStateDescription,
                useUnmergedTree = true
            )
        }
    }

    private fun hasSemanticsNodeWithDescriptions(
        expectedContentDescription: String,
        expectedStateDescription: String,
        useUnmergedTree: Boolean
    ): Boolean {
        return composeRule.onAllNodes(
            matcher = hasContentDescription(expectedContentDescription),
            useUnmergedTree = useUnmergedTree
        ).fetchSemanticsNodes().any { node ->
            node.config.getOrNull(SemanticsProperties.StateDescription) == expectedStateDescription
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

    private fun fillAiComposerDraft(draftText: String) {
        val sendLabel = composeRule.activity.getString(AiFeatureR.string.ai_send)
        val filled = tryFillAiComposerDraftWithTextReplacement(
            draftText = draftText,
            sendLabel = sendLabel
        ) || tryFillAiComposerDraftWithTextInput(
            draftText = draftText,
            sendLabel = sendLabel
        )
        if (filled) {
            return
        }

        throw AssertionError(
            "AI composer draft was not ready for screenshot. " +
                "ExpectedDraft='$draftText' " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = sendLabel)}"
        )
    }

    private fun tryFillAiComposerDraftWithTextReplacement(draftText: String, sendLabel: String): Boolean {
        val composerField = composeRule.onNodeWithTag(aiComposerMessageFieldTag)
        return try {
            dismissExternalSystemDialogIfPresent()
            composerField.performClick()
            composeRule.waitForIdle()
            composerField.performTextClearance()
            composeRule.waitForIdle()
            composerField.performTextReplacement(draftText)
            composeRule.waitForIdle()
            waitForAiComposerDraftReady(draftText = draftText, sendLabel = sendLabel)
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun tryFillAiComposerDraftWithTextInput(draftText: String, sendLabel: String): Boolean {
        val composerField = composeRule.onNodeWithTag(aiComposerMessageFieldTag)
        return try {
            dismissExternalSystemDialogIfPresent()
            composerField.performClick()
            composeRule.waitForIdle()
            composerField.performTextClearance()
            composeRule.waitForIdle()
            composerField.performTextInput(draftText)
            composeRule.waitForIdle()
            waitForAiComposerDraftReady(draftText = draftText, sendLabel = sendLabel)
            true
        } catch (_: Throwable) {
            false
        }
    }

    private fun waitForAiComposerDraftReady(draftText: String, sendLabel: String) {
        waitUntilWithSystemDialogMitigation(timeoutMillis = aiScreenshotUiTimeoutMillis) {
            aiComposerDraftTextOrNull() == draftText &&
                aiComposerSendButtonMatchesState(
                    expectedLabel = sendLabel,
                    expectedEnabled = true
                )
        }
    }

    private fun waitForAiComposerCardHandoffState(sendLabel: String) {
        try {
            waitUntilWithSystemDialogMitigation(timeoutMillis = aiAttachmentUiTimeoutMillis) {
                countNodesWithTagInAnySemanticsTree(tag = aiComposerPendingAttachmentTag) > 0 &&
                    aiComposerDraftTextOrNull().isNullOrBlank() &&
                    aiComposerSendButtonMatchesState(
                        expectedLabel = sendLabel,
                        expectedEnabled = true
                    )
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "AI composer did not reach the card handoff state for marketing screenshot. " +
                    "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                    "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = sendLabel)}",
                error
            )
        }
    }

    private fun aiComposerDraftTextOrNull(): String? {
        val mergedValue = composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.EditableText)
            ?.text
        if (mergedValue != null) {
            return mergedValue
        }

        return composeRule.onAllNodesWithTag(aiComposerMessageFieldTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.EditableText)
            ?.text
    }

    private fun visibleCardsFrontTexts(): List<String> {
        return composeRule.onAllNodesWithTag(cardsCardFrontTextTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .map(::nodeTextSummary)
            .filter { text -> text.isNotBlank() }
    }

    private fun nodeTextSummary(node: SemanticsNode): String {
        val texts: List<String> = node.config.getOrNull(SemanticsProperties.Text)
            ?.map { text -> text.text.trim() }
            ?.filter { text -> text.isNotBlank() }
            .orEmpty()
        return texts.joinToString(separator = " | ")
    }

    private fun aiComposerSendButtonMatchesState(expectedLabel: String, expectedEnabled: Boolean): Boolean {
        val state = aiComposerSendButtonStateOrNull(expectedLabel = expectedLabel)
        return if (expectedEnabled) {
            state == "enabled"
        } else {
            state == "disabled"
        }
    }

    private fun aiComposerSendButtonStateOrNull(expectedLabel: String): String? {
        val mergedNode = composeRule.onAllNodes(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasContentDescription(expectedLabel))
        ).fetchSemanticsNodes().singleOrNull()
        if (mergedNode != null) {
            return if (mergedNode.config.contains(SemanticsProperties.Disabled)) {
                "disabled"
            } else {
                "enabled"
            }
        }

        val unmergedNode = composeRule.onAllNodes(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasContentDescription(expectedLabel)),
            useUnmergedTree = true
        ).fetchSemanticsNodes().singleOrNull() ?: return null
        return if (unmergedNode.config.contains(SemanticsProperties.Disabled)) {
            "disabled"
        } else {
            "enabled"
        }
    }

    private fun clearAiComposerFocus() {
        dismissExternalSystemDialogIfPresent()
        if (countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0) {
            composeRule.onNodeWithTag(aiConversationSurfaceTag, useUnmergedTree = true).performClick()
            composeRule.waitForIdle()
        }
        dismissExternalSystemDialogIfPresent()
    }

    private fun countNodesWithTagInAnySemanticsTree(tag: String): Int {
        val mergedCount: Int = composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().size
        val unmergedCount: Int = composeRule.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
        return maxOf(mergedCount, unmergedCount)
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

    fun runShellCommand(command: String): String {
        val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
            BufferedReader(InputStreamReader(inputStream)).use { reader ->
                return reader.readText()
            }
        }
    }

}
