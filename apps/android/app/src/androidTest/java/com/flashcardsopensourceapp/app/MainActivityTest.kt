package com.flashcardsopensourceapp.app

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiConversationSurfaceTag
import com.flashcardsopensourceapp.feature.cards.cardEditorBackSummaryCardTag
import com.flashcardsopensourceapp.feature.cards.cardEditorBackTextFieldTag
import com.flashcardsopensourceapp.feature.cards.cardEditorFrontSummaryCardTag
import com.flashcardsopensourceapp.feature.cards.cardEditorFrontTextFieldTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTag
import com.flashcardsopensourceapp.feature.review.reviewAiCardButtonTag
import com.flashcardsopensourceapp.feature.review.reviewEditCardButtonTag
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

@RunWith(AndroidJUnit4::class)
class MainActivityTest : FirebaseAppInstrumentationTimeoutTest() {
    companion object {
        private const val uiTimeoutMillis: Long = 20_000L
        private const val emptyCardsMessage: String = "No cards yet. Tap the add button to create the first card."
    }

    private val appStateResetRule = AppStateResetRule()

    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun topLevelNavigationShowsCardsSettingsAndReviewEmptyState() {
        waitForCardsEmptyState()
        composeRule.onNodeWithText("Search cards").fetchSemanticsNode()

        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()

        openReviewTabAndAssertEmptyState()
    }

    @Test
    fun workspaceSettingsShowsTitleAndVisibleBackButton() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).performClick()

        composeRule.onNodeWithText("Workspace Settings").fetchSemanticsNode()
        composeRule.onNodeWithContentDescription("Back").fetchSemanticsNode()
        tapVisibleBackButton()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
    }

    @Test
    fun accountStatusAndSignInShowTitlesAndVisibleBackButton() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account Settings").fetchSemanticsNode()

        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Account Status").fetchSemanticsNode()
        composeRule.onNodeWithText("Sign in or sign up").performClick()
        composeRule.onNodeWithText("Sign in").fetchSemanticsNode()
        composeRule.onNodeWithContentDescription("Back").fetchSemanticsNode()
        tapVisibleBackButton()
        composeRule.onNodeWithText("Account Status").fetchSemanticsNode()
    }

    @Test
    fun reviewEmptyStateShowsPrimaryHandoffs() {
        waitForCardsEmptyState()

        openReviewTabAndAssertEmptyState()
        composeRule.onNodeWithText("Create card").fetchSemanticsNode()
        composeRule.onNodeWithText("Create with AI").fetchSemanticsNode()
    }

    @Test
    fun reviewEmptyStateCreateCardOpensEditor() {
        waitForCardsEmptyState()

        openReviewTabAndAssertEmptyState()
        composeRule.onNodeWithText("Create card").performClick()
        composeRule.onNodeWithText("New card").fetchSemanticsNode()
        tapVisibleBackButton()
        openReviewTabAndAssertEmptyState()
    }

    @Test
    fun reviewEmptyStateCreateWithAiOpensConsentGate() {
        waitForCardsEmptyState()

        openReviewTabAndAssertEmptyState()
        composeRule.onNodeWithText("Create with AI").performClick()
        assertAiConsentGateIsVisible()
    }

    @Test
    fun aiConsentAcceptanceOpensConversationSurface() {
        waitForCardsEmptyState()

        openAiTabAndAssertConsentGate()
        acceptAiConsentAndWaitForConversation()
        composeRule.onNodeWithTag(aiConversationSurfaceTag).fetchSemanticsNode()
        composeRule.onNodeWithText("Message").fetchSemanticsNode()
    }

    @Test
    fun aiConversationSurfaceTapClearsComposerFocus() {
        waitForCardsEmptyState()

        openAiTabAndAssertConsentGate()
        acceptAiConsentAndWaitForConversation()

        composeRule.onNodeWithTag(aiComposerMessageFieldTag).performClick()
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).assertIsFocused()

        composeRule.onNodeWithTag(aiConversationSurfaceTag).performClick()
        waitUntilComposerIsNotFocused()
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).assertIsNotFocused()
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
        composeRule.onNodeWithText("Fast | draft, android | new").fetchSemanticsNode()

        openCardFilter()
        composeRule.onNodeWithText("draft (1)").performClick()
        composeRule.onNodeWithText("Apply").performClick()
        composeRule.onNodeWithText("Android card").fetchSemanticsNode()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("No cards match the current filters.").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithText("Clear").performClick()

        composeRule.onNodeWithText("Android card").performClick()
        updateCardText(
            summaryTag = cardEditorFrontSummaryCardTag,
            editorFieldTag = cardEditorFrontTextFieldTag,
            value = "Updated Android card"
        )
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
            composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("This came from the Android app.").fetchSemanticsNodes().isEmpty()
        }
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("Updated Android card").fetchSemanticsNodes().isNotEmpty()
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
    fun workspaceDecksFlowCreatesDeckAndOpensMatchingCardAfterCreatingCards() {
        waitForCardsEmptyState()
        createCardsForWorkspaceSettingsFlows()

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
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(
                matcher = hasText("SQLite note").and(other = hasClickAction())
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasText("SQLite note").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Edit card").fetchSemanticsNode()
        composeRule.onNodeWithText("Stored locally.").fetchSemanticsNode()
    }

    @Test
    fun workspaceTagsFlowShowsMatchingCardCountAfterCreatingCards() {
        waitForCardsEmptyState()
        createCardsForWorkspaceSettingsFlows()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Search tags").performTextInput("ui")
        composeRule.onNodeWithText("ui").fetchSemanticsNode()
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
    fun workspaceOverviewShowsRenameNoticeFromEmptyState() {
        waitForCardsEmptyState()

        openWorkspaceSettings()
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithText("Danger zone").fetchSemanticsNode()
        composeRule.onNodeWithText("Workspace rename is available only for linked cloud workspaces.").fetchSemanticsNode()
    }

    @Test
    fun accountStatusShowsCloudStatusFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Cloud status").fetchSemanticsNode()
    }

    @Test
    fun accountAgentConnectionsShowsSignInGuidanceFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNodeWithText("Agent connections").performClick()
        composeRule.onNodeWithText("Agent Connections").fetchSemanticsNode()
        composeRule.onNodeWithText("Sign in to the cloud account to manage long-lived bot connections.").fetchSemanticsNode()
    }

    @Test
    fun accountDangerZoneShowsDeleteActionFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNode(
            matcher = hasText("Danger zone").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Danger Zone").fetchSemanticsNode()
        composeRule.onNodeWithText("Delete my account").fetchSemanticsNode()
    }

    @Test
    fun deviceDiagnosticsShowWorkspaceIdFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = "This Device")
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Workspace ID").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun accessCameraUsageDetailsOpenFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = "Access")
        composeRule.onNodeWithText("Camera").fetchSemanticsNode()
        composeRule.onNodeWithText("Camera").performClick()
        composeRule.onNodeWithText("Usage").fetchSemanticsNode()
    }

    @Test
    fun workspaceExportShowsCsvActionFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Export").performClick()
        composeRule.onNodeWithText("Export CSV").fetchSemanticsNode()
        composeRule.onNodeWithText("CSV export").fetchSemanticsNode()
    }

    @Test
    fun reviewShowsAndRatesCardCreatedFromEmptyState() {
        waitForCardsEmptyState()
        createCard(
            frontText = "Review me",
            backText = "Rated from the review screen.",
            tags = listOf("review")
        )

        openReviewTab()
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
    fun reviewScreenShowsFilterAndEditActionsBeforeReveal() {
        waitForCardsEmptyState()
        createReviewOverlayFixtureCard()

        openReviewTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewFilterButtonTag).fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithTag(reviewFilterButtonTag).fetchSemanticsNode()
        composeRule.onNodeWithText("All cards").fetchSemanticsNode()
        composeRule.onNodeWithTag(reviewEditCardButtonTag).fetchSemanticsNode()
        assertTrue(composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isEmpty())
        assertTrue(composeRule.onAllNodesWithText("Edit card").fetchSemanticsNodes().isEmpty())

        composeRule.onNodeWithTag(reviewFilterButtonTag).performClick()
        composeRule.onNodeWithText("Review scope").fetchSemanticsNode()
        composeRule.onNodeWithText("Review the full local queue").performClick()
    }

    @Test
    fun reviewScreenShowsRatingAndAiActionsAfterReveal() {
        waitForCardsEmptyState()
        createReviewOverlayFixtureCard()

        openReviewTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
        }

        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Again").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Hard").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Good").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText("Easy").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithTag(reviewAiCardButtonTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).fetchSemanticsNode()
        composeRule.onNodeWithTag(reviewEditCardButtonTag).fetchSemanticsNode()
        composeRule.onNodeWithTag(reviewAiCardButtonTag).fetchSemanticsNode()
    }

    private fun waitForCardsEmptyState() {
        openCardsTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty()
                && composeRule.onAllNodesWithText(emptyCardsMessage).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openReviewTabAndAssertEmptyState() {
        openReviewTab()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewEmptyStateTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(reviewEmptyStateContentTag).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("No cards yet").fetchSemanticsNode()
    }

    private fun openAiTabAndAssertConsentGate() {
        openAiTab()
        assertAiConsentGateIsVisible()
    }

    private fun assertAiConsentGateIsVisible() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText("OK").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Before you use AI").fetchSemanticsNode()
    }

    private fun acceptAiConsentAndWaitForConversation() {
        composeRule.onNodeWithText("OK").performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isEmpty() &&
                composeRule.onAllNodesWithTag(aiConversationSurfaceTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitUntilComposerIsNotFocused() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            val composerNodes = composeRule.onAllNodesWithTag(aiComposerMessageFieldTag).fetchSemanticsNodes()
            composerNodes.size == 1 && composerNodes[0].config.getOrNull(SemanticsProperties.Focused) == false
        }
    }

    private fun createCard(frontText: String, backText: String, tags: List<String>) {
        openCardsTab()
        composeRule.onNodeWithContentDescription("Add card").performClick()
        updateCardText(
            summaryTag = cardEditorFrontSummaryCardTag,
            editorFieldTag = cardEditorFrontTextFieldTag,
            value = frontText
        )
        updateCardText(
            summaryTag = cardEditorBackSummaryCardTag,
            editorFieldTag = cardEditorBackTextFieldTag,
            value = backText
        )
        if (tags.isNotEmpty()) {
            composeRule.onNodeWithText("Tags").performClick()
            tags.forEach { tag ->
                composeRule.onNodeWithText("Add a tag").performTextInput(tag)
                composeRule.onNodeWithText("Add tag").performClick()
            }
            tapVisibleBackButton()
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

    private fun createCardsForWorkspaceSettingsFlows() {
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
    }

    private fun createReviewOverlayFixtureCard() {
        createCard(
            frontText = "Visible review contract",
            backText = "First line.\n\nSecond line that is long enough to require scrolling behind the action overlay.",
            tags = listOf("review", "android")
        )
    }

    private fun openCardsTab() {
        composeRule.onNode(
            matcher = hasText("Cards").and(other = hasClickAction())
        ).performClick()
    }

    private fun openReviewTab() {
        composeRule.onNode(
            matcher = hasText("Review").and(other = hasClickAction())
        ).performClick()
    }

    private fun openAiTab() {
        composeRule.onNode(
            matcher = hasText("AI").and(other = hasClickAction())
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

    private fun openWorkspaceSettings() {
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Workspace").and(other = hasClickAction())
        ).performClick()
    }

    private fun openAccountSettings() {
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
    }

    private fun updateCardText(summaryTag: String, editorFieldTag: String, value: String) {
        composeRule.onNodeWithTag(summaryTag).performScrollTo()
        composeRule.onNodeWithTag(summaryTag).performClick()
        composeRule.onNodeWithTag(editorFieldTag).fetchSemanticsNode()
        composeRule.onNodeWithTag(editorFieldTag).performTextReplacement(value)
        tapVisibleBackButton()
    }

    private fun tapVisibleBackButton() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodes(
                matcher = hasContentDescription("Back").and(other = hasClickAction())
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasContentDescription("Back").and(other = hasClickAction())
        ).performClick()
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
