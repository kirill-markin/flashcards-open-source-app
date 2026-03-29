package com.flashcardsopensourceapp.app

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInSendCodeButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceNameTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceOperationMessageTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteWorkspaceButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewSaveNameButtonTag
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@OptIn(ExperimentalTestApi::class)
class LiveSmokeTest {
    companion object {
        private const val externalUiTimeoutMillis: Long = 120_000L
        private const val selectionUiTimeoutMillis: Long = 20_000L
        private const val workspaceMutationUiTimeoutMillis: Long = 30_000L
        private const val reviewEmailArgumentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
        private const val cloudSyncChooserPrompt: String =
            "Choose a linked workspace to open on this Android device, or create a new one."
    }

    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @Test
    fun liveSmokeFlowUsesRealDemoAccountAcrossTabs() {
        val runId = System.currentTimeMillis().toString()
        val reviewEmail = InstrumentationRegistry.getArguments()
            .getString(reviewEmailArgumentKey, "google-review@example.com")
        val workspaceName = "E2E android $runId"
        val manualFrontText = "Manual e2e android $runId"
        val manualBackText = "Manual answer e2e android $runId"
        val aiFrontText = "AI e2e android $runId"
        val aiBackText = "AI answer e2e android $runId"

        var primaryFailure: Throwable? = null

        try {
            step("sign in with the configured review account") {
                signInWithReviewAccount(reviewEmail = reviewEmail)
            }
            step("create an isolated linked workspace for this run") {
                createEphemeralWorkspace(workspaceName = workspaceName)
            }
            step("create one manual card") {
                createManualCard(
                    frontText = manualFrontText,
                    backText = manualBackText,
                    markerTag = "manual-$runId"
                )
            }
            step("verify the manual card in cards and review") {
                assertCardVisibleInCards(searchText = manualFrontText)
                reviewOneCard()
            }
            step("restart the activity and keep the linked session") {
                relaunchAndAssertAccountStatus(reviewEmail = reviewEmail)
            }
            step("create one AI card with explicit confirmation") {
                createAiCardWithConfirmation(
                    aiFrontText = aiFrontText,
                    aiBackText = aiBackText,
                    markerTag = "ai-$runId"
                )
            }
            step("verify the AI-created card is visible in cards and review") {
                assertCardVisibleInCards(searchText = aiFrontText)
                assertReviewQueueLoads()
            }
            step("verify linked account status and workspace state") {
                assertLinkedAccountStatus(reviewEmail = reviewEmail, workspaceName = workspaceName)
            }
        } catch (error: Throwable) {
            primaryFailure = error
            throw error
        } finally {
            try {
                step("delete the isolated workspace") {
                    deleteEphemeralWorkspace(workspaceName = workspaceName)
                }
            } catch (cleanupError: Throwable) {
                if (primaryFailure != null) {
                    primaryFailure.addSuppressed(cleanupError)
                } else {
                    throw cleanupError
                }
            }
        }
    }

    /**
     * This smoke test is intentionally one connected user story. Each step
     * fails fast with its own label so the CI output points to the exact cross-
     * screen integration boundary that regressed.
     */
    private fun step(label: String, action: () -> Unit) {
        try {
            action()
        } catch (error: Throwable) {
            throw AssertionError("Android live smoke step failed: $label", error)
        }
    }

    private fun signInWithReviewAccount(reviewEmail: String) {
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.onNodeWithText("Sign in or sign up").performClick()
        composeRule.onNodeWithTag(cloudSignInEmailFieldTag).performTextInput(reviewEmail)
        composeRule.onNodeWithTag(cloudSignInSendCodeButtonTag).performClick()

        composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
            hasVisibleText(text = "Sync now")
                || hasVisibleText(text = "Preparing", substring = true)
                || hasVisibleText(text = cloudSyncChooserPrompt)
        }

        if (hasVisibleText(text = cloudSyncChooserPrompt)) {
            throw AssertionError(
                "Cloud sync chooser still required manual selection for the review account. " +
                    "Visible rows=${captureVisibleWorkspaceRows(rowTag = cloudPostAuthWorkspaceRowTag)}"
            )
        }

        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Sync now"),
            timeoutMillis = externalUiTimeoutMillis
        )
        tapBackIcon()
        tapBackIcon()
    }

    private fun createEphemeralWorkspace(workspaceName: String) {
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Create new workspace"),
            timeoutMillis = selectionUiTimeoutMillis
        )
        waitForSelectedWorkspaceSummary(
            context = "before creating a linked workspace",
            timeoutMillis = selectionUiTimeoutMillis
        )
        val selectedWorkspaceSummaryBeforeCreate = selectedWorkspaceSummary(
            context = "before creating a linked workspace"
        )
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceCreateButtonTag)
        )
        composeRule.onNodeWithTag(currentWorkspaceCreateButtonTag).performClick()
        waitForCurrentWorkspaceOperationToStart()
        waitForSelectedWorkspaceSummaryToChange(
            beforeSummary = selectedWorkspaceSummaryBeforeCreate,
            context = "after creating a linked workspace",
            timeoutMillis = externalUiTimeoutMillis
        )
        waitForCurrentWorkspaceOperationToFinish()
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
        composeRule.onNodeWithTag(workspaceOverviewSaveNameButtonTag).performClick()
        waitForWorkspaceRenameOutcome(expectedWorkspaceName = workspaceName)
        tapBackIcon()
        tapBackIcon()
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").performClick()
        waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceName)
        tapBackIcon()
    }

    private fun createManualCard(frontText: String, backText: String, markerTag: String) {
        openCardsTab()
        composeRule.onNodeWithContentDescription("Add card").performClick()
        updateCardText(fieldTitle = "Front", value = frontText)
        updateCardText(fieldTitle = "Back", value = backText)
        composeRule.onNodeWithText("Tags").performClick()
        composeRule.onNodeWithText("Add a tag").performTextInput(markerTag)
        composeRule.onNodeWithText("Add tag").performClick()
        tapBackIcon()
        composeRule.onNode(
            matcher = hasClickAction().and(other = hasText("Save"))
        ).performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(frontText),
            timeoutMillis = selectionUiTimeoutMillis
        )
    }

    private fun reviewOneCard() {
        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Show answer"),
            timeoutMillis = selectionUiTimeoutMillis
        )
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = selectionUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun relaunchAndAssertAccountStatus(reviewEmail: String) {
        composeRule.activityRule.scenario.recreate()
        openSettingsTab()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(reviewEmail),
            timeoutMillis = selectionUiTimeoutMillis
        )
        tapBackIcon()
        tapBackIcon()
    }

    private fun createAiCardWithConfirmation(
        aiFrontText: String,
        aiBackText: String,
        markerTag: String
    ) {
        composeRule.onNodeWithText("AI").performClick()
        dismissAiConsentIfNeeded()
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).performTextReplacement(
            "Prepare exactly one flashcard proposal. Use front text '$aiFrontText', back text '$aiBackText', and include tag '$markerTag'. Wait for my confirmation before creating it."
        )
        composeRule.onNodeWithTag(aiComposerSendButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
            composeRule.onAllNodesWithText(aiFrontText, substring = true).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText(markerTag, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).performTextReplacement(
            "Confirmed. Create the card exactly as proposed."
        )
        composeRule.onNodeWithTag(aiComposerSendButtonTag).performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Done"),
            timeoutMillis = externalUiTimeoutMillis
        )
    }

    private fun assertCardVisibleInCards(searchText: String) {
        openCardsTab()
        composeRule.onNodeWithText("Search cards").performTextReplacement(searchText)
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(searchText),
            timeoutMillis = selectionUiTimeoutMillis
        )
    }

    private fun assertReviewQueueLoads() {
        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntil(timeoutMillis = selectionUiTimeoutMillis) {
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun assertLinkedAccountStatus(reviewEmail: String, workspaceName: String) {
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
        composeRule.onNode(
            matcher = hasText("Account").and(other = hasClickAction())
        ).performClick()
        composeRule.onNodeWithText("Account status").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(reviewEmail),
            timeoutMillis = selectionUiTimeoutMillis
        )
        composeRule.onNodeWithText("Linked").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Account Settings").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
        composeRule.onNodeWithText(workspaceName).fetchSemanticsNode()
    }

    private fun deleteEphemeralWorkspace(workspaceName: String) {
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Create new workspace"),
            timeoutMillis = selectionUiTimeoutMillis
        )
        if (composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty()) {
            tapBackIcon()
            return
        }
        waitForSelectedWorkspaceSummary(
            context = "before deleting the isolated linked workspace",
            timeoutMillis = selectionUiTimeoutMillis
        )
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithTag(workspaceOverviewDeleteWorkspaceButtonTag).performClick()
        composeRule.onNodeWithTag(workspaceOverviewDeletePreviewContinueButtonTag).performClick()
        composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationFieldTag)
            .performTextReplacement("delete workspace")
        composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationButtonTag).performClick()
        tapBackIcon()
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").performClick()
        composeRule.waitUntil(timeoutMillis = workspaceMutationUiTimeoutMillis) {
            composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty()
        }
        waitForSelectedWorkspaceSummary(
            context = "after deleting the isolated linked workspace",
            timeoutMillis = workspaceMutationUiTimeoutMillis
        )
        tapBackIcon()
    }

    private fun openCardsTab() {
        composeRule.onNode(
            matcher = hasText("Cards").and(other = hasClickAction())
        ).performClick()
    }

    private fun openSettingsTab() {
        composeRule.onNode(
            matcher = hasText("Settings").and(other = hasClickAction())
        ).performClick()
    }

    private fun openSettingsSection(sectionTitle: String) {
        openSettingsTab()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(sectionTitle),
            timeoutMillis = selectionUiTimeoutMillis
        )
        composeRule.onNode(
            matcher = hasText(sectionTitle).and(other = hasClickAction())
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

    private fun waitForSelectedWorkspaceSummary(context: String, timeoutMillis: Long) {
        try {
            scrollCurrentWorkspaceListToSelectedWorkspace()
            composeRule.waitUntil(timeoutMillis = timeoutMillis) {
                selectedWorkspaceSummaryOrNull() != null
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current workspace selection did not settle $context. " +
                    "Visible linked workspaces=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                    "Current workspace name=${currentWorkspaceNameOrNull()}",
                error
            )
        }
    }

    private fun waitForSelectedWorkspaceSummaryToChange(
        beforeSummary: String,
        context: String,
        timeoutMillis: Long
    ) {
        try {
            composeRule.waitUntil(timeoutMillis = timeoutMillis) {
                runCatching {
                    val errorMessage = currentWorkspaceErrorMessageOrNull()
                    if (errorMessage != null) {
                        throw AssertionError("Current workspace action failed: $errorMessage")
                    }
                    scrollCurrentWorkspaceListToSelectedWorkspace()
                    selectedWorkspaceSummary(context = context) != beforeSummary
                }.getOrDefault(defaultValue = false)
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current workspace selection did not change $context. " +
                    "Before=$beforeSummary After=${selectedWorkspaceSummaryOrNull()} " +
                    "Current workspace name=${currentWorkspaceNameOrNull()} " +
                    "Error=${currentWorkspaceErrorMessageOrNull()}",
                error
            )
        }
    }

    private fun waitForCurrentWorkspaceOperationToStart() {
        try {
            composeRule.waitUntil(timeoutMillis = selectionUiTimeoutMillis) {
                currentWorkspaceOperationMessageOrNull() != null
                    || currentWorkspaceErrorMessageOrNull() != null
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current workspace operation did not start after tapping create. " +
                    "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                    "Current workspace name=${currentWorkspaceNameOrNull()} " +
                    "Error=${currentWorkspaceErrorMessageOrNull()}",
                error
            )
        }
    }

    private fun waitForCurrentWorkspaceOperationToFinish() {
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                val errorMessage = currentWorkspaceErrorMessageOrNull()
                if (errorMessage != null) {
                    throw AssertionError("Current workspace operation failed: $errorMessage")
                }
                currentWorkspaceOperationMessageOrNull() == null
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current workspace operation did not finish. " +
                    "Operation=${currentWorkspaceOperationMessageOrNull()} " +
                    "SelectedRow=${selectedWorkspaceSummaryOrNull()} " +
                    "Current workspace name=${currentWorkspaceNameOrNull()} " +
                    "Error=${currentWorkspaceErrorMessageOrNull()}",
                error
            )
        }
    }

    private fun waitForWorkspaceRenameOutcome(expectedWorkspaceName: String) {
        try {
            composeRule.waitUntil(timeoutMillis = workspaceMutationUiTimeoutMillis) {
                val errorMessage = workspaceOverviewErrorMessageOrNull()
                if (errorMessage != null) {
                    throw AssertionError("Workspace rename failed: $errorMessage")
                }

                workspaceOverviewNameFieldValueOrNull() == expectedWorkspaceName
                    && hasVisibleText(text = "Saving...").not()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Workspace rename did not persist on the Overview screen. " +
                    "FieldValue=${workspaceOverviewNameFieldValueOrNull()} " +
                    "Error=${workspaceOverviewErrorMessageOrNull()}",
                error
            )
        }
    }

    private fun waitForCurrentWorkspaceName(expectedWorkspaceName: String) {
        try {
            composeRule.waitUntil(timeoutMillis = selectionUiTimeoutMillis) {
                currentWorkspaceNameOrNull() == expectedWorkspaceName
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current Workspace top card did not update after rename. " +
                    "TopCard=${currentWorkspaceNameOrNull()} " +
                    "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
                error
            )
        }
    }

    private fun selectedWorkspaceSummary(context: String): String {
        val selectedSummary = selectedWorkspaceSummaryOrNull()
        return requireNotNull(selectedSummary) {
            "Current workspace selection was missing $context."
        }
    }

    private fun selectedWorkspaceSummaryOrNull(): String? {
        val selectedRows = captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)
            .filter { row -> row.contains("(Current)") }
        if (selectedRows.size > 1) {
            throw AssertionError(
                "Current Workspace rendered more than one selected workspace row. " +
                    "Visible selected rows=$selectedRows"
            )
        }
        return selectedRows.singleOrNull()
    }

    private fun workspaceOverviewNameFieldValueOrNull(): String? {
        return composeRule.onAllNodesWithTag(workspaceOverviewNameFieldTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.EditableText)
            ?.text
    }

    private fun workspaceOverviewErrorMessageOrNull(): String? {
        return composeRule.onAllNodesWithTag(workspaceOverviewErrorMessageTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun currentWorkspaceNameOrNull(): String? {
        return composeRule.onAllNodesWithTag(currentWorkspaceNameTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun currentWorkspaceErrorMessageOrNull(): String? {
        return composeRule.onAllNodesWithTag(currentWorkspaceErrorMessageTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun currentWorkspaceOperationMessageOrNull(): String? {
        return composeRule.onAllNodesWithTag(currentWorkspaceOperationMessageTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun scrollCurrentWorkspaceListToSelectedWorkspace() {
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasText("(Current)", substring = true)
        )
    }

    private fun captureVisibleWorkspaceRows(rowTag: String): List<String> {
        return composeRule.onAllNodesWithTag(rowTag)
            .fetchSemanticsNodes()
            .map(::nodeSummary)
    }

    private fun nodeSummary(node: SemanticsNode): String {
        val texts = node.config.getOrNull(SemanticsProperties.Text)
            ?.map { text -> text.text }
            ?.filter { text -> text.isNotBlank() }
            .orEmpty()
        return texts.joinToString(separator = " | ")
    }

    private fun hasVisibleText(text: String, substring: Boolean = false): Boolean {
        return composeRule.onAllNodesWithText(text = text, substring = substring)
            .fetchSemanticsNodes()
            .isNotEmpty()
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
}
