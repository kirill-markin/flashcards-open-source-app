package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateContentTag
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateTag
import com.flashcardsopensourceapp.feature.review.reviewEditCardButtonTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTag
import com.flashcardsopensourceapp.feature.review.reviewFilterButtonTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import com.flashcardsopensourceapp.feature.settings.schedulerApplyButtonTag
import com.flashcardsopensourceapp.feature.settings.schedulerDesiredRetentionFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerLearningStepsFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerMaximumIntervalFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerRelearningStepsFieldTag
import com.flashcardsopensourceapp.feature.settings.schedulerSaveButtonTag
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import kotlin.math.abs

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    companion object {
        private const val uiTimeoutMillis: Long = 10_000L
        private const val emptyCardsMessage: String = "No cards yet. Tap the add button to create the first card."
    }

    private val appStateResetRule = AppStateResetRule()

    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun navigationShowsAllTopLevelScreensFromEmptyState() {
        waitForCardsEmptyState()
        composeRule.onNodeWithText("Search cards").fetchSemanticsNode()

        composeRule.onNodeWithText("AI").performClick()
        dismissAiConsentIfNeeded()
        composeRule.onNodeWithTag(aiEmptyStateTag).fetchSemanticsNode()
        composeRule.onNodeWithText("Try asking").fetchSemanticsNode()
        composeRule.onNodeWithText("Message").fetchSemanticsNode()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).fetchSemanticsNode()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.onNodeWithText("No cards yet").fetchSemanticsNode()
    }

    @Test
    fun settingsScreensShowTitlesAndBackNavigation() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()

        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Workspace Settings").fetchSemanticsNode()
        composeRule.onNodeWithContentDescription("Back").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account Settings").fetchSemanticsNode()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Account Status").fetchSemanticsNode()
        composeRule.onNodeWithText("Sign in or sign up").performClick()
        composeRule.onNodeWithText("Sign in").fetchSemanticsNode()
        composeRule.onNodeWithContentDescription("Back").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Account Status").fetchSemanticsNode()
    }

    @Test
    fun cardsCreateFilterEditDeleteFlowWorksFromEmptyState() {
        waitForCardsEmptyState()

        createCard(
            frontText = "Android card",
            backText = "This came from the Android app.",
            tags = listOf("draft", "android")
        )

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Android card").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("This came from the Android app.").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNode(
            matcher = hasText("Fast", substring = true)
        ).fetchSemanticsNode()
        composeRule.onNode(
            matcher = hasText("draft, android", substring = true)
        ).fetchSemanticsNode()
        composeRule.onNode(
            matcher = hasText("new", substring = true)
        ).fetchSemanticsNode()

        openCardFilter()
        composeRule.onNodeWithText("draft (1)").performClick()
        composeRule.onNodeWithText("Apply").performClick()
        composeRule.onNodeWithText("Android card").fetchSemanticsNode()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("No cards match the current filters.").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("Clear").performClick()

        composeRule.onNodeWithText("Android card").performClick()
        updateCardText(fieldTitle = "Front", value = "Updated Android card")
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("This came from the Android app.").fetchSemanticsNodes().isEmpty()
        }

        composeRule.onNodeWithText("Updated Android card").performClick()
        scrollToText(text = "Delete card")
        composeRule.onNodeWithText("Delete card").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText(emptyCardsMessage).fetchSemanticsNode()
    }

    @Test
    fun workspaceDecksAndTagsFlowWorksAfterCreatingCards() {
        waitForCardsEmptyState()
        createCard(
            frontText = "SQLite note",
            backText = "Stored locally.",
            tags = listOf("storage")
        )
        createCard(
            frontText = "Compose note",
            backText = "Rendered declaratively.",
            tags = listOf("ui")
        )

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Decks").performClick()

        composeRule.onNodeWithContentDescription("Add deck").performClick()
        composeRule.onNodeWithText("Deck name").performTextInput("Storage deck")
        composeRule.onNodeWithText("storage (1)").performClick()
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Storage deck").fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithText("Storage deck").performClick()
        composeRule.onNode(
            matcher = hasText("SQLite note", substring = true).and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()
        tapBackIcon()

        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Search tags").performTextInput("ui")
        composeRule.onNodeWithText("1 cards").fetchSemanticsNode()
    }

    @Test
    fun schedulerSettingsFlowUpdatesWorkspaceSummaryFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Scheduler").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(schedulerDesiredRetentionFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerLearningStepsFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerRelearningStepsFieldTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(schedulerMaximumIntervalFieldTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performTextReplacement("0.85")
        composeRule.onNodeWithTag(schedulerLearningStepsFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerLearningStepsFieldTag).performTextReplacement("1, 10")
        composeRule.onNodeWithTag(schedulerRelearningStepsFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerRelearningStepsFieldTag).performTextReplacement("10")
        composeRule.onNodeWithTag(schedulerMaximumIntervalFieldTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerMaximumIntervalFieldTag).performTextReplacement("36500")
        composeRule.onNodeWithTag(schedulerSaveButtonTag).performScrollTo()
        composeRule.onNodeWithTag(schedulerSaveButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(schedulerApplyButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(schedulerApplyButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Overview").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Scheduler").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Scheduler").performClick()
        composeRule.onNodeWithTag(schedulerDesiredRetentionFieldTag).performScrollTo()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("0.85").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun settingsAccountDeviceAccessAndExportFlowsOpenFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithText("Danger zone").fetchSemanticsNode()
        composeRule.onNodeWithText("Workspace rename is available only for linked cloud workspaces.").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Cloud status").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("Agent connections").performClick()
        composeRule.onNodeWithText("Agent Connections").fetchSemanticsNode()
        composeRule.onNodeWithText("Sign in to the cloud account to manage long-lived bot connections.").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNode(
            matcher = hasText("Danger zone").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Danger Zone").fetchSemanticsNode()
        composeRule.onNodeWithText("Delete my account").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()

        openSettingsSection(sectionTitle = "This Device")
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Workspace ID").fetchSemanticsNodes().isNotEmpty()
        }
        tapBackIcon()

        openSettingsSection(sectionTitle = "Access")
        composeRule.onNodeWithText("Camera").fetchSemanticsNode()
        composeRule.onNodeWithText("Camera").performClick()
        composeRule.onNodeWithText("Usage").fetchSemanticsNode()
        tapBackIcon()
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Export").performClick()
        composeRule.onNodeWithText("Export CSV").fetchSemanticsNode()
    }

    @Test
    fun reviewEmptyStateSupportsGuidedCreationHandoffs() {
        waitForCardsEmptyState()

        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewEmptyStateTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewEmptyStateContentTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("No cards yet").fetchSemanticsNode()
        composeRule.onNodeWithText("Create card").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").fetchSemanticsNode()
        assertReviewEmptyStateIsCentered()

        composeRule.onNodeWithText("Create card").performClick()
        composeRule.onNodeWithText("New card").fetchSemanticsNode()
        tapBackIcon()

        composeRule.onNodeWithText("No cards yet").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").performClick()
        dismissAiConsentIfNeeded()
        composeRule.onNodeWithTag(aiEmptyStateTag).fetchSemanticsNode()
        composeRule.onNodeWithTag(aiEmptyStateContentTag).fetchSemanticsNode()
        assertAiEmptyStateIsCentered()
        composeRule.onNodeWithText("Message").fetchSemanticsNode()
    }

    @Test
    fun reviewShowsAndRatesCardCreatedFromEmptyState() {
        waitForCardsEmptyState()
        createCard(
            frontText = "Review me",
            backText = "Rated from the review screen.",
            tags = listOf("review")
        )

        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).performClick()

        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Session complete").fetchSemanticsNode()
    }

    @Test
    fun reviewScreenShowsVisibleFilterAndOverlayActions() {
        waitForCardsEmptyState()
        createCard(
            frontText = "Visible review contract",
            backText = "First line.\n\nSecond line that is long enough to require scrolling behind the action overlay.",
            tags = listOf("review", "android")
        )

        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewFilterButtonTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).fetchSemanticsNode()
        composeRule.onNodeWithText("All cards").fetchSemanticsNode()
        composeRule.onNodeWithTag(reviewEditCardButtonTag).fetchSemanticsNode()
        assertTrue(composeRule.onAllNodesWithText("Edit card").fetchSemanticsNodes().isEmpty())

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithText("Review scope").fetchSemanticsNode()
        composeRule.onNodeWithText("Review the full local queue").performClick()

        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Again").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Hard").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Good").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Easy").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).fetchSemanticsNode()
    }

    private fun waitForCardsEmptyState() {
        openCardsTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText(emptyCardsMessage).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun assertReviewEmptyStateIsCentered() {
        val containerBounds = composeRule.onNodeWithTag(reviewEmptyStateTag).fetchSemanticsNode().boundsInRoot
        val contentBounds = composeRule.onNodeWithTag(reviewEmptyStateContentTag).fetchSemanticsNode().boundsInRoot
        val containerCenterX = (containerBounds.left + containerBounds.right) / 2f
        val containerCenterY = (containerBounds.top + containerBounds.bottom) / 2f
        val contentCenterX = (contentBounds.left + contentBounds.right) / 2f
        val contentCenterY = (contentBounds.top + contentBounds.bottom) / 2f
        val maxCenterOffsetPx = 4f

        assertTrue(abs(containerCenterX - contentCenterX) <= maxCenterOffsetPx)
        assertTrue(abs(containerCenterY - contentCenterY) <= maxCenterOffsetPx)
        assertTrue(contentBounds.width < composeRule.onRoot().fetchSemanticsNode().boundsInRoot.width)
    }

    private fun assertAiEmptyStateIsCentered() {
        val containerBounds = composeRule.onNodeWithTag(aiEmptyStateTag).fetchSemanticsNode().boundsInRoot
        val contentBounds = composeRule.onNodeWithTag(aiEmptyStateContentTag).fetchSemanticsNode().boundsInRoot
        val containerCenterX = (containerBounds.left + containerBounds.right) / 2f
        val containerCenterY = (containerBounds.top + containerBounds.bottom) / 2f
        val contentCenterX = (contentBounds.left + contentBounds.right) / 2f
        val contentCenterY = (contentBounds.top + contentBounds.bottom) / 2f
        val maxCenterOffsetPx = 4f

        assertTrue(abs(containerCenterX - contentCenterX) <= maxCenterOffsetPx)
        assertTrue(abs(containerCenterY - contentCenterY) <= maxCenterOffsetPx)
        assertTrue(contentBounds.width < composeRule.onRoot().fetchSemanticsNode().boundsInRoot.width)
    }

    private fun createCard(frontText: String, backText: String, tags: List<String>) {
        openCardsTab()
        composeRule.onNodeWithContentDescription("Add card").performClick()
        updateCardText(fieldTitle = "Front", value = frontText)
        updateCardText(fieldTitle = "Back", value = backText)
        if (tags.isNotEmpty()) {
            composeRule.onNodeWithText("Tags").performClick()
            tags.forEach { tag ->
                composeRule.onNodeWithText("Add a tag").performTextInput(tag)
                composeRule.onNodeWithText("Add tag").performClick()
            }
            tapBackIcon()
        }
        scrollToText(text = "Save")
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(
                matcher = hasClickAction().and(other = hasText("Save"))
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasClickAction().and(other = hasText("Save"))
        ).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openCardsTab() {
        composeRule.onNode(
            matcher = hasText("Cards").and(other = hasClickAction())
        ).performClick()
    }

    private fun openCardFilter() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(
                hasContentDescription("Filter cards").and(other = hasClickAction())
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasContentDescription("Filter cards").and(other = hasClickAction())
        ).performClick()
    }

    private fun openSettingsTab() {
        composeRule.onNode(
            matcher = hasText("Settings").and(other = hasClickAction())
        ).performClick()
    }

    private fun dismissAiConsentIfNeeded() {
        if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithText("OK").performClick()
        }
    }

    private fun updateCardText(fieldTitle: String, value: String) {
        composeRule.onNodeWithText(fieldTitle).performClick()
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
        tapBackIcon()
    }

    private fun tapBackIcon() {
        if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
            composeRule.onNodeWithContentDescription("Back").performClick()
        } else {
            composeRule.activity.runOnUiThread {
                composeRule.activity.onBackPressedDispatcher.onBackPressed()
            }
            composeRule.waitForIdle()
        }
    }

    private fun openSettingsSection(sectionTitle: String) {
        openSettingsTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(
                matcher = hasText(sectionTitle).and(other = hasClickAction())
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasText(sectionTitle).and(other = hasClickAction())
        ).performClick()
    }

    private fun scrollToText(text: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
    }
}
