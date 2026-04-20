package com.flashcardsopensourceapp.app

import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
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
import com.flashcardsopensourceapp.feature.ai.aiConversationLoadingTag
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
import com.flashcardsopensourceapp.feature.settings.workspaceTagCardsCountTag
import com.flashcardsopensourceapp.feature.settings.workspaceTagRowTag
import com.flashcardsopensourceapp.feature.settings.workspaceTagsSearchFieldTag
import com.flashcardsopensourceapp.feature.ai.R as AiFeatureR
import com.flashcardsopensourceapp.app.R as AppR
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import kotlinx.coroutines.runBlocking
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
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_root_current_workspace_title)).fetchSemanticsNode()

        openReviewTabAndAssertEmptyState()
    }

    @Test
    fun appGraphCanBeRecreatedWhileActivityRemainsOpen() {
        waitForCardsEmptyState()
        val application = composeRule.activity.application as FlashcardsApplication

        runBlocking {
            application.recreateAppGraphAndAwaitStartup()
        }
        composeRule.waitForIdle()

        waitForCardsEmptyState()
        composeRule.onNodeWithText("Search cards").fetchSemanticsNode()
    }

    @Test
    fun workspaceSettingsShowsTitleAndVisibleBackButton() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_root_current_workspace_title)).fetchSemanticsNode()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_root_workspace_title)).and(other = hasClickAction())
        ).performClick()

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_title)).fetchSemanticsNode()
        composeRule.onNodeWithContentDescription(settingsString(SettingsR.string.settings_back_content_description)).fetchSemanticsNode()
        tapVisibleBackButton()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_root_current_workspace_title)).fetchSemanticsNode()
    }

    @Test
    fun accountStatusAndSignInShowTitlesAndVisibleBackButton() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_root_account_title)).and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_title)).fetchSemanticsNode()

        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_screen_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_sign_in_button)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_sign_in_title)).fetchSemanticsNode()
        composeRule.onNodeWithContentDescription(settingsString(SettingsR.string.settings_back_content_description)).fetchSemanticsNode()
        tapVisibleBackButton()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_screen_title)).fetchSemanticsNode()
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
        acceptAiConsentAndWaitForConversationSurface()
        composeRule.onNodeWithTag(aiConversationSurfaceTag).fetchSemanticsNode()
    }

    @Test
    fun aiConversationSurfaceTapClearsComposerFocus() {
        waitForCardsEmptyState()

        openAiTabAndAssertConsentGate()
        acceptAiConsentAndWaitForConversationComposer()

        focusAiComposerAndWaitUntilFocused()
        assertTrue(
            "Expected the AI composer to be focused before dismissing focus.",
            aiComposerFocusStateOrNull() == true
        )

        composeRule.onNodeWithTag(aiConversationSurfaceTag).performClick()
        waitUntilComposerIsNotFocused()
        assertTrue(
            "Expected tapping the AI conversation surface to clear the composer focus.",
            aiComposerFocusStateOrNull() == false
        )
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

        openSettingsSection(sectionTitle = settingsString(SettingsR.string.settings_section_workspace))
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_decks_title)).performClick()

        composeRule.onNodeWithContentDescription(settingsString(SettingsR.string.settings_decks_add_content_description)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_deck_editor_name_label)).performTextInput("Storage deck")
        composeRule.onNodeWithText("storage (1)").performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_save)).performClick()

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

        openSettingsSection(sectionTitle = settingsString(SettingsR.string.settings_section_workspace))
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_tags_title)).performClick()
        waitForWorkspaceTagsScreen()
        composeRule.onNodeWithTag(workspaceTagsSearchFieldTag).performClick()
        composeRule.onNodeWithTag(workspaceTagsSearchFieldTag).performTextReplacement("ui")
        waitForWorkspaceTagsFilteredResult(tag = "ui", cardsCount = 1, excludedTag = "storage")
        composeRule.onNodeWithTag(workspaceTagRowTag(tag = "ui")).fetchSemanticsNode()
        composeRule.onNodeWithTag(
            testTag = workspaceTagCardsCountTag(tag = "ui"),
            useUnmergedTree = true
        ).fetchSemanticsNode()
    }

    @Test
    fun schedulerSettingsFlowUpdatesWorkspaceSummaryFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsTab()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_root_workspace_title)).and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_scheduler_title)).performClick()
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
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_overview_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_card_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_rename_guidance)).fetchSemanticsNode()
    }

    @Test
    fun accountStatusShowsCloudStatusFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_status_cloud_status_label)).fetchSemanticsNode()
    }

    @Test
    fun accountAgentConnectionsShowsSignInGuidanceFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_agent_connections_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_agent_connections_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_agent_connections_sign_in_guidance)).fetchSemanticsNode()
    }

    @Test
    fun accountDangerZoneShowsDeleteActionFromEmptyState() {
        waitForCardsEmptyState()

        openAccountSettings()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_account_danger_zone_section)).and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_account_danger_zone_delete_button)).fetchSemanticsNode()
    }

    @Test
    fun deviceDiagnosticsShowWorkspaceIdFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = settingsString(SettingsR.string.settings_root_device_title))
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText(settingsString(SettingsR.string.settings_device_workspace_id_label)).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun accessCameraUsageDetailsOpenFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = settingsString(SettingsR.string.settings_root_access_title))
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_access_camera_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_access_camera_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_access_usage_label)).fetchSemanticsNode()
    }

    @Test
    fun workspaceExportShowsCsvActionFromEmptyState() {
        waitForCardsEmptyState()

        openSettingsSection(sectionTitle = settingsString(SettingsR.string.settings_section_workspace))
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_workspace_export_title)).performClick()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_export_csv_title)).fetchSemanticsNode()
        composeRule.onNodeWithText(settingsString(SettingsR.string.settings_export_csv_summary)).fetchSemanticsNode()
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
            composeRule.onAllNodesWithText(aiString(AiFeatureR.string.ai_consent_title)).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(aiString(AiFeatureR.string.ai_consent_accept)).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText(aiString(AiFeatureR.string.ai_consent_title)).fetchSemanticsNode()
    }

    private fun acceptAiConsentAndWaitForConversationSurface() {
        composeRule.onNodeWithText(aiString(AiFeatureR.string.ai_consent_accept)).performClick()
        waitForAiConversationSurface()
    }

    private fun acceptAiConsentAndWaitForConversationReady() {
        composeRule.onNodeWithText(aiString(AiFeatureR.string.ai_consent_accept)).performClick()
        waitForAiConversationReady()
    }

    private fun acceptAiConsentAndWaitForConversationComposer() {
        composeRule.onNodeWithText(aiString(AiFeatureR.string.ai_consent_accept)).performClick()
        waitForAiConversationComposer()
    }

    private fun waitForAiConversationSurface() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText(aiString(AiFeatureR.string.ai_consent_title)).fetchSemanticsNodes().isEmpty() &&
                countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0
        }
    }

    private fun waitForAiConversationComposer() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText(aiString(AiFeatureR.string.ai_consent_title)).fetchSemanticsNodes().isEmpty() &&
                countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
        }
    }

    private fun waitUntilComposerIsNotFocused() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            aiComposerFocusStateOrNull() == false
        }
    }

    private fun waitForAiConversationReady() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithText(aiString(AiFeatureR.string.ai_consent_title)).fetchSemanticsNodes().isEmpty() &&
                countNodesWithTagInAnySemanticsTree(tag = aiConversationLoadingTag) == 0 &&
                countNodesWithTagInAnySemanticsTree(tag = aiConversationSurfaceTag) > 0 &&
                countNodesWithTagInAnySemanticsTree(tag = aiComposerMessageFieldTag) > 0
        }
    }

    private fun focusAiComposerAndWaitUntilFocused() {
        waitForAiConversationComposer()
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).performClick()
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            aiComposerFocusStateOrNull() == true
        }
    }

    private fun aiComposerFocusStateOrNull(): Boolean? {
        val mergedFocusState: Boolean? = composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
            .fetchSemanticsNodes()
            .firstOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.Focused)
        if (mergedFocusState != null) {
            return mergedFocusState
        }

        return composeRule.onAllNodesWithTag(aiComposerMessageFieldTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .firstOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.Focused)
    }

    private fun countNodesWithTagInAnySemanticsTree(tag: String): Int {
        val mergedCount: Int = composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().size
        val unmergedCount: Int = composeRule.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
        return maxOf(mergedCount, unmergedCount)
    }

    private fun waitForWorkspaceTagsScreen() {
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            composeRule.onAllNodesWithTag(workspaceTagsSearchFieldTag).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(workspaceTagRowTag(tag = "storage")).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(workspaceTagRowTag(tag = "ui")).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForWorkspaceTagsFilteredResult(tag: String, cardsCount: Int, excludedTag: String) {
        val expectedCardsCountText: String = settingsQuantityString(
            SettingsR.plurals.settings_tag_cards_count,
            cardsCount,
            cardsCount
        )
        composeRule.waitUntil(timeoutMillis = uiTimeoutMillis) {
            searchFieldValue(tag = workspaceTagsSearchFieldTag) == tag &&
                composeRule.onAllNodesWithTag(workspaceTagRowTag(tag = tag)).fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithTag(
                    testTag = workspaceTagCardsCountTag(tag = tag),
                    useUnmergedTree = true
                )
                    .fetchSemanticsNodes()
                    .any { node ->
                        node.config.getOrNull(SemanticsProperties.Text)?.any { text ->
                            text.text == expectedCardsCountText
                        } == true
                    } &&
                composeRule.onAllNodesWithTag(workspaceTagRowTag(tag = excludedTag)).fetchSemanticsNodes().isEmpty()
        }
    }

    private fun searchFieldValue(tag: String): String? {
        return composeRule.onAllNodesWithTag(tag)
            .fetchSemanticsNodes()
            .firstOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.EditableText)
            ?.text
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
            matcher = hasText(appString(AppR.string.top_level_settings)).and(other = hasClickAction())
        ).performClick()
    }

    private fun openWorkspaceSettings() {
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_root_workspace_title)).and(other = hasClickAction())
        ).performClick()
    }

    private fun openAccountSettings() {
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText(settingsString(SettingsR.string.settings_root_account_title)).and(other = hasClickAction())
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
                matcher = hasContentDescription(settingsString(SettingsR.string.settings_back_content_description)).and(other = hasClickAction())
            ).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNode(
            matcher = hasContentDescription(settingsString(SettingsR.string.settings_back_content_description)).and(other = hasClickAction())
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

    private fun appString(@StringRes resId: Int): String {
        return composeRule.activity.getString(resId)
    }

    private fun aiString(@StringRes resId: Int): String {
        return composeRule.activity.getString(resId)
    }

    private fun settingsString(@StringRes resId: Int, vararg args: Any): String {
        return composeRule.activity.getString(resId, *args)
    }

    private fun settingsQuantityString(@PluralsRes resId: Int, quantity: Int, vararg args: Any): String {
        return composeRule.activity.resources.getQuantityString(resId, quantity, *args)
    }
}
