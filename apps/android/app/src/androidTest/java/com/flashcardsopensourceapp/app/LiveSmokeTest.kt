package com.flashcardsopensourceapp.app

import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateTag
import com.flashcardsopensourceapp.feature.ai.aiNewChatButtonTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.cards.cardsCardFrontTextTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewCurrentCardFrontContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTitleTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInSendCodeButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceExistingRowTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceLoadingStateTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceNameTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceOperationMessageTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceReloadButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationErrorTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteWorkspaceButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewErrorMessageTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewSaveNameButtonTag
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.rules.TestName
import org.junit.runner.RunWith
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.io.BufferedReader
import java.io.InputStreamReader
import java.time.Instant

@RunWith(AndroidJUnit4::class)
@OptIn(ExperimentalTestApi::class)
class LiveSmokeTest {
    private enum class DeletePreviewResolution {
        PREVIEW_READY,
        ERROR_VISIBLE
    }

    companion object {
        private const val externalUiTimeoutMillis: Long = 30_000L
        private const val internalUiTimeoutMillis: Long = 10_000L
        private const val reviewEmailArgumentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
        private const val cloudSyncChooserPrompt: String =
            "Choose a linked workspace to open on this Android device, or create a new one."
        private const val systemDialogWaitButtonText: String = "Wait"
        private const val systemDialogCloseAppButtonText: String = "Close app"
        private val blockingSystemDialogTitles: List<String> = listOf(
            "System UI",
            "Digital Wellbeing"
        )
    }

    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()
    private val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private var currentStepLabel: String = "test bootstrap"
    private var hasPrintedInlineRawScreenStateForCurrentFailure: Boolean = false

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @get:Rule
    val testNameRule: TestName = TestName()

    @Test
    fun linkedWorkspaceSessionSurvivesActivityRelaunch() {
        val runId = System.currentTimeMillis().toString()
        val reviewEmail = configuredReviewEmail()
        val workspaceName = "E2E android session $runId"

        withLinkedWorkspaceSession(
            reviewEmail = reviewEmail,
            workspaceName = workspaceName
        ) {
            step("restart the activity and keep the linked session") {
                relaunchAndAssertAccountStatus(reviewEmail = reviewEmail)
            }
            step("verify linked account status and workspace state") {
                assertLinkedAccountStatus(reviewEmail = reviewEmail, workspaceName = workspaceName)
            }
        }
    }

    @Test
    fun manualCardCanBeCreatedAndReviewedInDefaultWorkspace() {
        val runId = System.currentTimeMillis().toString()
        val manualFrontText = "Manual e2e android $runId"
        val manualBackText = "Manual answer e2e android $runId"

        step("create one manual card in the default local workspace") {
            createManualCard(
                frontText = manualFrontText,
                backText = manualBackText,
                markerTag = "manual-$runId"
            )
        }
        step("verify the manual card in cards and review") {
            assertCardVisibleInCards(
                searchText = manualFrontText,
                timeoutMillis = internalUiTimeoutMillis
            )
            reviewOneCard()
        }
    }

    @Test
    fun aiCardCanBeCreatedAsGuestInDefaultWorkspace() {
        val runId = System.currentTimeMillis().toString()
        val aiFrontText = "AI e2e android $runId"
        val aiBackText = "AI answer e2e android $runId"

        step("create one AI card with explicit confirmation as guest in the default workspace") {
            createAiCardWithConfirmation(
                aiFrontText = aiFrontText,
                aiBackText = aiBackText,
                markerTag = "ai-$runId"
            )
        }
        step("start a new chat and confirm the conversation resets cleanly") {
            startNewChatAndAssertConversationReset()
        }
        step("force a sync in the current guest workspace and wait for the AI card locally") {
            forceSyncAndWaitForLocalCard(
                expectedFrontText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
        }
        step("restart the activity after AI card creation and keep the guest session") {
            relaunchAndAssertGuestAccountStatus()
        }
        step("verify the AI-created card in cards and review") {
            assertCardVisibleInCards(
                searchText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
            assertCardReachableInReview(
                expectedFrontText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
        }
    }

    private fun configuredReviewEmail(): String {
        return InstrumentationRegistry.getArguments()
            .getString(reviewEmailArgumentKey, "google-review@example.com")
    }

    private fun withLinkedWorkspaceSession(
        reviewEmail: String,
        workspaceName: String,
        action: () -> Unit
    ) {
        var primaryFailure: Throwable? = null
        var shouldDeleteWorkspace = false

        try {
            step("sign in with the configured review account") {
                signInWithReviewAccount(reviewEmail = reviewEmail)
            }
            step("create an isolated linked workspace for this run") {
                shouldDeleteWorkspace = true
                createEphemeralWorkspace(workspaceName = workspaceName)
            }
            action()
        } catch (error: Throwable) {
            primaryFailure = error
            throw error
        } finally {
            if (shouldDeleteWorkspace) {
                if (primaryFailure != null) {
                    resetInlineRawScreenStateFailureGuard()
                }
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
    }

    /**
     * This smoke suite is intentionally split into a few stateful groups.
     * The manual and AI groups stay local-first, while the linked-session group
     * owns linked workspace setup so regressions stay independently attributable.
     */
    private fun step(label: String, action: () -> Unit) {
        val previousStepLabel = currentStepLabel
        currentStepLabel = label
        try {
            action()
        } catch (error: Throwable) {
            emitInlineRawScreenStateIfNeeded(action = "step.$label")
            throw AssertionError("Android live smoke step failed: $label", error)
        } finally {
            currentStepLabel = previousStepLabel
        }
    }

    private fun signInWithReviewAccount(reviewEmail: String) {
        openSettingsTab()
        clickNode(
            matcher = hasText("Account").and(other = hasClickAction()),
            label = "Account"
        )
        clickText(text = "Account status")
        clickText(text = "Sign in or sign up")
        composeRule.onNodeWithTag(cloudSignInEmailFieldTag).performTextInput(reviewEmail)
        clickTag(tag = cloudSignInSendCodeButtonTag, label = "Send code")

        composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
            failIfVisibleAppError(context = "while waiting for sign-in to reach cloud sync")
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
        clickText(text = "Current Workspace")
        waitForCurrentWorkspaceScreenToSettle()
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Create new workspace"),
            timeoutMillis = internalUiTimeoutMillis
        )
        waitForSelectedWorkspaceSummary(
            context = "before creating a linked workspace",
            timeoutMillis = internalUiTimeoutMillis
        )
        val selectedWorkspaceSummaryBeforeCreate = selectedWorkspaceSummary(
            context = "before creating a linked workspace"
        )
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceCreateButtonTag)
        )
        clickTag(tag = currentWorkspaceCreateButtonTag, label = "Create new workspace")
        waitForCurrentWorkspaceOperationToStart()
        waitForCurrentWorkspaceOperationToFinish()
        waitForSelectedWorkspaceSummaryToChange(
            beforeSummary = selectedWorkspaceSummaryBeforeCreate,
            context = "after creating a linked workspace",
            timeoutMillis = internalUiTimeoutMillis
        )
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        clickText(text = "Overview")
        composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
        clickTag(tag = workspaceOverviewSaveNameButtonTag, label = "Save workspace name")
        waitForWorkspaceRenameOutcome(expectedWorkspaceName = workspaceName)
        tapBackIcon()
        tapBackIcon()
        openSettingsTab()
        clickText(text = "Current Workspace")
        waitForCurrentWorkspaceScreenToSettle()
        waitForCurrentWorkspaceName(expectedWorkspaceName = workspaceName)
        tapBackIcon()
    }

    private fun createManualCard(frontText: String, backText: String, markerTag: String) {
        openCardsTab()
        clickContentDescription(contentDescription = "Add card")
        updateCardText(fieldTitle = "Front", value = frontText)
        updateCardText(fieldTitle = "Back", value = backText)
        clickText(text = "Tags")
        composeRule.onNodeWithText("Add a tag").performTextInput(markerTag)
        clickText(text = "Add tag")
        tapBackIcon()
        scrollToText(text = "Save")
        composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
            failIfVisibleAppError(context = "while waiting for Save card")
            composeRule.onAllNodes(
                matcher = hasClickAction().and(other = hasText("Save"))
            ).fetchSemanticsNodes().isNotEmpty()
        }
        clickNode(
            matcher = hasClickAction().and(other = hasText("Save")),
            label = "Save card"
        )
        composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
            failIfVisibleAppError(context = "while waiting for the saved manual card to appear")
            composeRule.onAllNodesWithText("Search cards").fetchSemanticsNodes().isNotEmpty() &&
                composeRule.onAllNodesWithText(frontText).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun reviewOneCard() {
        clickText(text = "Review")
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Show answer"),
            timeoutMillis = internalUiTimeoutMillis
        )
        clickTag(tag = reviewShowAnswerButtonTag, label = "Show answer")
        clickTag(tag = reviewRateGoodButtonTag, label = "Rate Good")
        composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
            failIfVisibleAppError(context = "while waiting for the review queue to advance")
            composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun relaunchAndAssertAccountStatus(reviewEmail: String) {
        composeRule.activityRule.scenario.recreate()
        openSettingsTab()
        clickNode(
            matcher = hasText("Account").and(other = hasClickAction()),
            label = "Account"
        )
        clickText(text = "Account status")
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText(reviewEmail),
            timeoutMillis = internalUiTimeoutMillis
        )
        tapBackIcon()
        tapBackIcon()
    }

    private fun relaunchAndAssertGuestAccountStatus() {
        composeRule.activityRule.scenario.recreate()
        openSettingsTab()
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Guest AI"),
            timeoutMillis = internalUiTimeoutMillis
        )
        clickNode(
            matcher = hasText("Account").and(other = hasClickAction()),
            label = "Account"
        )
        clickText(text = "Account status")
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Guest AI"),
            timeoutMillis = internalUiTimeoutMillis
        )
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Guest AI session"),
            timeoutMillis = internalUiTimeoutMillis
        )
        if (hasVisibleText(text = "Linked")) {
            throw AssertionError("Guest AI smoke unexpectedly reached a linked account state.")
        }
        tapBackIcon()
        tapBackIcon()
    }

    private fun createAiCardWithConfirmation(
        aiFrontText: String,
        aiBackText: String,
        markerTag: String
    ) {
        val proposalPrompt =
            "Prepare exactly one flashcard proposal. Use front text '$aiFrontText', back text '$aiBackText', and include tag '$markerTag'. Wait for my confirmation before creating it."
        val confirmationPrompt = "Confirmed. Create the card exactly as proposed."

        clickText(text = "AI")
        dismissAiConsentIfNeeded()
        waitForGuestCloudWorkspaceReady(context = "before filling the AI proposal prompt")
        fillAiComposerWithRetry(
            expectedDraftText = proposalPrompt,
            context = "for the AI proposal prompt"
        )
        clickTag(tag = aiComposerSendButtonTag, label = "Send AI prompt")
        waitForAssistantProposal(
            aiFrontText = aiFrontText,
            aiBackText = aiBackText,
            markerTag = markerTag
        )
        fillAiComposerWithRetry(
            expectedDraftText = confirmationPrompt,
            context = "for the AI confirmation prompt"
        )
        clickTag(tag = aiComposerSendButtonTag, label = "Confirm AI card creation")
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText("Stop")),
            timeoutMillis = externalUiTimeoutMillis
        )
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText("Send")),
            timeoutMillis = externalUiTimeoutMillis
        )
        if (hasVisibleText(text = "I'm missing the actual proposed card text in this chat")) {
            throw AssertionError(
                "AI confirmation asked for missing proposal details instead of creating the card."
            )
        }
    }

    private fun startNewChatAndAssertConversationReset() {
        clickTag(tag = aiNewChatButtonTag, label = "New chat")
        try {
            waitUntilWithMitigation(
                timeoutMillis = externalUiTimeoutMillis,
                context = "while waiting for New chat to reset the AI conversation"
            ) {
                composeRule.onAllNodesWithTag(aiEmptyStateTag).fetchSemanticsNodes().isNotEmpty() &&
                    composeRule.onAllNodesWithTag(aiAssistantMessageBubbleTag).fetchSemanticsNodes().isEmpty() &&
                    composeRule.onAllNodesWithTag(aiUserMessageBubbleTag).fetchSemanticsNodes().isEmpty()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "New chat did not reset the AI conversation. " +
                    "EmptyStateVisible=${composeRule.onAllNodesWithTag(aiEmptyStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                    "AssistantMessages=${composeRule.onAllNodesWithTag(aiAssistantMessageBubbleTag).fetchSemanticsNodes().size} " +
                    "UserMessages=${composeRule.onAllNodesWithTag(aiUserMessageBubbleTag).fetchSemanticsNodes().size} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun assertCardVisibleInCards(searchText: String, timeoutMillis: Long) {
        openCardsTab()
        composeRule.onNodeWithText("Search cards").performTextReplacement(searchText)
        try {
            waitUntilWithMitigation(
                timeoutMillis = timeoutMillis,
                context = "while waiting for cards to show '$searchText'"
            ) {
                visibleCardsFrontTexts().any { text -> text == searchText }
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Cards did not show '$searchText'. " +
                    "VisibleCardFronts=${visibleCardsFrontTexts()} " +
                    "LocalCard=${localCardSnapshotOrNull(expectedFrontText = searchText)} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun assertCardReachableInReview(expectedFrontText: String, timeoutMillis: Long) {
        clickText(text = "Review")
        try {
            waitUntilWithMitigation(
                timeoutMillis = timeoutMillis,
                context = "while waiting for review to show '$expectedFrontText'"
            ) {
                currentReviewCardFrontTextOrNull()?.contains(other = expectedFrontText) == true
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Review did not show '$expectedFrontText'. " +
                    "CurrentReviewFront=${currentReviewCardFrontTextOrNull()} " +
                    "ReviewEmptyStateTitle=${reviewEmptyStateTitleOrNull()} " +
                    "LocalCard=${localCardSnapshotOrNull(expectedFrontText = expectedFrontText)} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun forceSyncAndWaitForLocalCard(expectedFrontText: String, timeoutMillis: Long) {
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
        try {
            runBlocking {
                appGraph.syncRepository.syncNow()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Forced sync after guest AI card creation failed. " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "Workspace=${currentWorkspaceSummaryOrNull()}",
                error
            )
        }

        try {
            waitUntilWithMitigation(
                timeoutMillis = timeoutMillis,
                context = "while waiting for the synced AI card '$expectedFrontText' to materialize locally"
            ) {
                localCardSnapshotOrNull(expectedFrontText = expectedFrontText) != null
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Forced sync completed but the AI card '$expectedFrontText' did not materialize locally. " +
                    "LocalCard=${localCardSnapshotOrNull(expectedFrontText = expectedFrontText)} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "Workspace=${currentWorkspaceSummaryOrNull()} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun assertLinkedAccountStatus(reviewEmail: String, workspaceName: String) {
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
        clickNode(
            matcher = hasText("Account").and(other = hasClickAction()),
            label = "Account"
        )
        clickText(text = "Account status")
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText(reviewEmail),
            timeoutMillis = internalUiTimeoutMillis
        )
        composeRule.onNodeWithText("Linked").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Account Settings").fetchSemanticsNode()
        tapBackIcon()
        composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
        composeRule.onNodeWithText(workspaceName).fetchSemanticsNode()
    }

    private fun deleteEphemeralWorkspace(workspaceName: String) {
        forceLinkedSyncAndWaitForWorkspace(
            expectedWorkspaceName = workspaceName,
            timeoutMillis = externalUiTimeoutMillis
        )
        openSettingsTab()
        clickText(text = "Current Workspace")
        waitForCurrentWorkspaceScreenToSettle()
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText("Create new workspace"),
            timeoutMillis = internalUiTimeoutMillis
        )
        if (composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty()) {
            tapBackIcon()
            return
        }
        waitForSelectedWorkspaceSummary(
            context = "before deleting the isolated linked workspace",
            timeoutMillis = internalUiTimeoutMillis
        )
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        clickText(text = "Overview")
        openDeletePreviewWithRetry(workspaceName = workspaceName)
        clickTag(
            tag = workspaceOverviewDeletePreviewContinueButtonTag,
            label = "Continue workspace delete preview"
        )
        waitForDeleteConfirmationReady(workspaceName = workspaceName)
        val confirmationPhrase = requireNotNull(deleteConfirmationPhraseOrNull()) {
            "Delete confirmation phrase was missing for workspace '$workspaceName'."
        }
        composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationFieldTag)
            .performTextReplacement(confirmationPhrase)
        tapDeleteWorkspaceConfirmation(workspaceName = workspaceName)
        tapBackIcon()
        openSettingsTab()
        clickText(text = "Current Workspace")
        waitForCurrentWorkspaceScreenToSettle()
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for workspace deletion to finish")
                val currentWorkspaceName = currentWorkspaceNameOrNull()
                val selectedSummary = selectedWorkspaceSummaryOrNull()
                composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty() &&
                    currentWorkspaceName != workspaceName &&
                    selectedSummary?.contains(other = workspaceName) != true
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Workspace deletion did not switch away from '$workspaceName'. " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                    "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                    "PreviewDialogVisible=${isDeletePreviewDialogVisible()} " +
                    "ConfirmationDialogVisible=${isDeleteConfirmationDialogVisible()}",
                error
            )
        }
        waitForSelectedWorkspaceSummary(
            context = "after deleting the isolated linked workspace",
            timeoutMillis = externalUiTimeoutMillis
        )
        tapBackIcon()
    }

    private fun forceLinkedSyncAndWaitForWorkspace(expectedWorkspaceName: String, timeoutMillis: Long) {
        val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
        try {
            runBlocking {
                appGraph.syncRepository.syncNow()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Forced linked sync before cleanup failed. " +
                    "Workspace=$expectedWorkspaceName " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
                error
            )
        }

        openSettingsTab()
        clickText(text = "Current Workspace")
        waitForCurrentWorkspaceScreenToSettle()
        waitForCurrentWorkspaceName(expectedWorkspaceName = expectedWorkspaceName)
        waitForSelectedWorkspaceSummary(
            context = "after forcing linked sync before cleanup",
            timeoutMillis = timeoutMillis
        )
        val selectedWorkspace = selectedWorkspaceSummary(
            context = "after forcing linked sync before cleanup"
        )
        if (selectedWorkspace.contains(other = expectedWorkspaceName).not()) {
            throw AssertionError(
                "Forced linked sync kept the wrong workspace selected before cleanup. " +
                    "ExpectedWorkspace=$expectedWorkspaceName " +
                    "SelectedWorkspace=$selectedWorkspace " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
            )
        }
        tapBackIcon()
    }

    private fun openDeletePreviewWithRetry(workspaceName: String) {
        clickTag(tag = workspaceOverviewDeleteWorkspaceButtonTag, label = "Delete workspace")
        val initialResolution = waitForDeletePreviewResolution(workspaceName = workspaceName)
        if (initialResolution == DeletePreviewResolution.PREVIEW_READY) {
            return
        }
        clickTag(tag = workspaceOverviewDeleteWorkspaceButtonTag, label = "Retry delete workspace preview")
        val retryResolution = waitForDeletePreviewResolution(workspaceName = workspaceName)
        if (retryResolution == DeletePreviewResolution.PREVIEW_READY) {
            return
        }
        throw AssertionError(
            "Delete workspace preview stayed in error state after retry. " +
                "Workspace=$workspaceName " +
                "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                "PreviewBody=${deletePreviewBodyTextOrNull()} " +
                "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                "CloudSettings=${currentCloudSettingsSummary()} " +
                "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
        )
    }

    private fun waitForDeletePreviewResolution(workspaceName: String): DeletePreviewResolution {
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                dismissExternalSystemDialogIfPresent()
                isDeletePreviewDialogVisible() || workspaceOverviewErrorMessageOrNull() != null
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Delete workspace preview did not resolve for '$workspaceName'. " +
                    "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                    "PreviewBody=${deletePreviewBodyTextOrNull()} " +
                    "VisibleRows=${captureVisibleWorkspaceRows(rowTag = currentWorkspaceExistingRowTag)} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
                error
            )
        }
        return if (isDeletePreviewDialogVisible()) {
            DeletePreviewResolution.PREVIEW_READY
        } else {
            DeletePreviewResolution.ERROR_VISIBLE
        }
    }

    private fun waitForDeleteConfirmationReady(workspaceName: String) {
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                dismissExternalSystemDialogIfPresent()
                isDeleteConfirmationDialogVisible() &&
                    deleteConfirmationPhraseOrNull().isNullOrBlank().not() &&
                    composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationFieldTag)
                        .fetchSemanticsNodes()
                        .isNotEmpty()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Delete confirmation dialog did not become ready for '$workspaceName'. " +
                    "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                    "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                    "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                    "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()}",
                error
            )
        }
    }

    private fun tapDeleteWorkspaceConfirmation(workspaceName: String) {
        dismissExternalSystemDialogIfPresent()
        composeRule.onNodeWithTag(workspaceOverviewDeleteConfirmationButtonTag).performClick()
        composeRule.waitForIdle()
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                dismissExternalSystemDialogIfPresent()
                val confirmationError = deleteConfirmationErrorOrNull()
                if (confirmationError != null) {
                    throw AssertionError(
                        "Delete workspace confirmation failed for '$workspaceName': $confirmationError. " +
                            "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                            "CloudSettings=${currentCloudSettingsSummary()} " +
                            "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}"
                    )
                }
                isDeleteConfirmationDialogVisible().not()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Delete workspace confirmation did not complete for '$workspaceName'. " +
                    "ConfirmationError=${deleteConfirmationErrorOrNull()} " +
                    "ConfirmationLoading=${isDeleteConfirmationLoadingVisible()} " +
                    "ConfirmationPhrase=${deleteConfirmationPhraseOrNull()} " +
                    "WorkspaceOverviewError=${workspaceOverviewErrorMessageOrNull()} " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "CurrentWorkspace=${currentWorkspaceSummaryOrNull()}",
                error
            )
        }
    }

    private fun openCardsTab() {
        clickNode(
            matcher = hasText("Cards").and(other = hasClickAction()),
            label = "Cards tab"
        )
    }

    private fun openSettingsTab() {
        clickNode(
            matcher = hasText("Settings").and(other = hasClickAction()),
            label = "Settings tab"
        )
    }

    private fun openSettingsSection(sectionTitle: String) {
        openSettingsTab()
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasText(sectionTitle),
            timeoutMillis = internalUiTimeoutMillis
        )
        clickNode(
            matcher = hasText(sectionTitle).and(other = hasClickAction()),
            label = sectionTitle
        )
    }

    private fun dismissAiConsentIfNeeded() {
        if (composeRule.onAllNodesWithText("Before you use AI").fetchSemanticsNodes().isNotEmpty()) {
            clickText(text = "OK")
        }
    }

    private fun updateCardText(fieldTitle: String, value: String) {
        clickText(text = fieldTitle)
        composeRule.onAllNodes(hasSetTextAction())[0].performTextReplacement(value)
        tapBackIcon()
    }

    private fun waitForSelectedWorkspaceSummary(context: String, timeoutMillis: Long) {
        try {
            scrollCurrentWorkspaceListToSelectedWorkspace()
            composeRule.waitUntil(timeoutMillis = timeoutMillis) {
                failIfVisibleAppError(context = "while waiting for current workspace selection $context")
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

    private fun waitForCurrentWorkspaceScreenToSettle() {
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                val visibleError = currentWorkspaceVisibleErrorMessageOrNull()
                if (visibleError != null) {
                    throw AssertionError("Current Workspace settled with an error: $visibleError")
                }

                val isLoading = composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
                if (isLoading) {
                    return@waitUntil false
                }

                composeRule.onAllNodesWithTag(currentWorkspaceCreateButtonTag)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
                    || composeRule.onAllNodesWithTag(currentWorkspaceReloadButtonTag)
                        .fetchSemanticsNodes()
                        .isNotEmpty()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current Workspace screen did not settle. " +
                    "Loading=${composeRule.onAllNodesWithTag(currentWorkspaceLoadingStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                    "Error=${currentWorkspaceVisibleErrorMessageOrNull()} " +
                    "SelectedRow=${selectedWorkspaceSummaryOrNull()}",
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
                failIfVisibleAppError(context = "while waiting for current workspace selection to change $context")
                runCatching {
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
            composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for current workspace operation to start")
                currentWorkspaceOperationMessageOrNull() != null
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
        waitForCurrentWorkspaceOperationToLeaveSwitchingState()
        try {
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for current workspace operation to finish")
                currentWorkspaceOperationMessageOrNull() == null &&
                    currentWorkspaceNameOrNull() != "Unavailable" &&
                    selectedWorkspaceSummaryOrNull() != null
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

    private fun waitForCurrentWorkspaceOperationToLeaveSwitchingState() {
        try {
            composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for current workspace operation to leave switching")
                currentWorkspaceOperationMessageOrNull()
                    ?.startsWith(prefix = "Switching to")
                    ?.not()
                    ?: true
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Current workspace operation stayed in SWITCHING without progressing. " +
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
            composeRule.waitUntil(timeoutMillis = externalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for workspace rename to persist")

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
            composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
                failIfVisibleAppError(context = "while waiting for Current Workspace top card to update")
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
        scrollCurrentWorkspaceListToTopCard()
        return composeRule.onAllNodesWithTag(currentWorkspaceNameTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun currentWorkspaceErrorMessageOrNull(): String? {
        scrollCurrentWorkspaceListToTopCard()
        return currentWorkspaceVisibleErrorMessageOrNull()
    }

    private fun currentWorkspaceVisibleErrorMessageOrNull(): String? {
        return composeRule.onAllNodesWithTag(currentWorkspaceErrorMessageTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun currentWorkspaceOperationMessageOrNull(): String? {
        scrollCurrentWorkspaceListToTopCard()
        return composeRule.onAllNodesWithTag(currentWorkspaceOperationMessageTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun scrollCurrentWorkspaceListToSelectedWorkspace() {
        if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
            return
        }
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasText("(Current)", substring = true)
        )
    }

    private fun scrollCurrentWorkspaceListToTopCard() {
        if (composeRule.onAllNodesWithTag(currentWorkspaceListTag).fetchSemanticsNodes().isEmpty()) {
            return
        }
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceNameTag)
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

    private fun resetInlineRawScreenStateFailureGuard() {
        hasPrintedInlineRawScreenStateForCurrentFailure = false
    }

    private fun emitInlineRawScreenStateIfNeeded(action: String) {
        if (hasPrintedInlineRawScreenStateForCurrentFailure) {
            return
        }

        hasPrintedInlineRawScreenStateForCurrentFailure = true
        System.err.println(inlineRawScreenStateBlock(action = action))
    }

    private fun inlineRawScreenStateBlock(action: String): String {
        val systemDialogSummary = currentBlockingSystemDialogSummaryOrNull() ?: "-"
        val activityName = composeRule.activity::class.java.simpleName
        return listOf(
            "===== BEGIN RAW SCREEN STATE =====",
            "platform: android",
            "test: ${testNameRule.methodName}",
            "step: $currentStepLabel",
            "action: $action",
            "capturedAt: ${Instant.now()}",
            "context: activity=$activityName systemDialog=$systemDialogSummary",
            "",
            "composeSemanticsTree:",
            captureComposeSemanticsTree(),
            "",
            "windowHierarchy:",
            captureWindowHierarchy(),
            "===== END RAW SCREEN STATE ====="
        ).joinToString(separator = "\n")
    }

    private fun captureComposeSemanticsTree(): String {
        return try {
            formatSemanticsNode(
                node = composeRule.onRoot(useUnmergedTree = true).fetchSemanticsNode(),
                depth = 0
            )
        } catch (error: Throwable) {
            "<compose semantics capture failed: ${error.message}>"
        }
    }

    private fun formatSemanticsNode(node: SemanticsNode, depth: Int): String {
        val indent = "  ".repeat(depth)
        val nodeLine = listOf(
            "${indent}- id=${node.id}",
            "bounds=${node.boundsInRoot}",
            "config=${node.config}"
        ).joinToString(separator = " ")
        val childLines = node.children.map { child ->
            formatSemanticsNode(node = child, depth = depth + 1)
        }
        return (listOf(nodeLine) + childLines).joinToString(separator = "\n")
    }

    private fun captureWindowHierarchy(): String {
        val dumpPath = "/sdcard/Download/flashcards-live-smoke-window-hierarchy.xml"
        return try {
            val command = "uiautomator dump $dumpPath >/dev/null 2>&1 && cat $dumpPath"
            runShellCommand(command = command).ifBlank { "<empty window hierarchy dump>" }
        } catch (error: Throwable) {
            "<window hierarchy capture failed: ${error.message}>"
        }
    }

    private fun <T> runWithInlineRawScreenStateOnFailure(
        action: String,
        operation: () -> T
    ): T {
        try {
            return operation()
        } catch (error: Throwable) {
            emitInlineRawScreenStateIfNeeded(action = action)
            throw error
        }
    }

    private fun hasVisibleText(text: String, substring: Boolean = false): Boolean {
        return composeRule.onAllNodesWithText(text = text, substring = substring)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }

    private fun waitUntilWithMitigation(
        timeoutMillis: Long,
        context: String,
        condition: () -> Boolean
    ) {
        runWithInlineRawScreenStateOnFailure(action = "wait_until_with_mitigation") {
            composeRule.waitUntil(timeoutMillis = timeoutMillis) {
                dismissExternalSystemDialogIfPresent()
                failIfVisibleAppError(context = context)
                condition()
            }
        }
    }

    private fun waitUntilAtLeastOneExistsOrFail(
        matcher: SemanticsMatcher,
        timeoutMillis: Long
    ) {
        waitUntilWithMitigation(
            timeoutMillis = timeoutMillis,
            context = "while waiting for UI state to appear"
        ) {
            composeRule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun clickNode(matcher: SemanticsMatcher, label: String) {
        runWithInlineRawScreenStateOnFailure(action = "click_node.$label") {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "before clicking $label")
            composeRule.onNode(matcher = matcher).performClick()
            composeRule.waitForIdle()
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "after clicking $label")
        }
    }

    private fun clickText(text: String, substring: Boolean = false) {
        runWithInlineRawScreenStateOnFailure(action = "click_text.$text") {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "before clicking '$text'")
            composeRule.onNodeWithText(text = text, substring = substring).performClick()
            composeRule.waitForIdle()
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "after clicking '$text'")
        }
    }

    private fun clickTag(tag: String, label: String) {
        runWithInlineRawScreenStateOnFailure(action = "click_tag.$tag") {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "before clicking $label")
            composeRule.onNodeWithTag(tag).performClick()
            composeRule.waitForIdle()
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "after clicking $label")
        }
    }

    private fun clickContentDescription(contentDescription: String) {
        runWithInlineRawScreenStateOnFailure(action = "click_content_description.$contentDescription") {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "before clicking '$contentDescription'")
            composeRule.onNodeWithContentDescription(contentDescription).performClick()
            composeRule.waitForIdle()
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "after clicking '$contentDescription'")
        }
    }

    private fun failIfVisibleAppError(context: String) {
        val visibleErrors = visibleAppErrors()
        if (visibleErrors.isNotEmpty()) {
            throw AssertionError(
                "Visible app error $context: ${visibleErrors.joinToString(separator = " || ")}"
            )
        }
    }

    private fun visibleAppErrors(): List<String> {
        val taggedErrors = listOfNotNull(
            currentWorkspaceVisibleErrorMessageOrNull(),
            workspaceOverviewErrorMessageOrNull()
        )
        val visibleFailureTexts = listOf(
            "Sync failed:",
            "failed",
            "invalid"
        ).flatMap { query ->
            composeRule.onAllNodesWithText(text = query, substring = true)
                .fetchSemanticsNodes()
                .map(::nodeSummary)
        }.filter { text ->
            text.isNotBlank() && text.startsWith(prefix = "Current workspace is now ").not()
        }
        return (taggedErrors + visibleFailureTexts).distinct()
    }

    private fun tapBackIcon() {
        runWithInlineRawScreenStateOnFailure(action = "tap_back_icon") {
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "before navigating back")
            if (composeRule.onAllNodes(matcher = hasContentDescription("Back")).fetchSemanticsNodes().isNotEmpty()) {
                composeRule.onNodeWithContentDescription("Back").performClick()
            } else {
                composeRule.activity.runOnUiThread {
                    composeRule.activity.onBackPressedDispatcher.onBackPressed()
                }
                composeRule.waitForIdle()
            }
            dismissExternalSystemDialogIfPresent()
            failIfVisibleAppError(context = "after navigating back")
        }
    }

    private fun waitForAiComposerEditable(context: String) {
        try {
            waitUntilWithMitigation(
                timeoutMillis = externalUiTimeoutMillis,
                context = "while waiting for the AI composer field to become editable $context"
            ) {
                aiComposerFieldIsEditable()
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "AI composer field was not editable $context. " +
                    "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                    "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = "Send")} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun fillAiComposerWithRetry(
        expectedDraftText: String,
        context: String
    ) {
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasTestTag(aiComposerMessageFieldTag),
            timeoutMillis = externalUiTimeoutMillis
        )
        val expectedButtonLabel = "Send"

        repeat(2) { attemptIndex ->
            dismissExternalSystemDialogIfPresent()
            waitForAiComposerEditable(context = "before filling $context")
            composeRule.onNodeWithTag(aiComposerMessageFieldTag).performClick()
            composeRule.waitForIdle()
            composeRule.onNodeWithTag(aiComposerMessageFieldTag).performTextReplacement(expectedDraftText)
            try {
                waitForAiComposerReady(
                    expectedDraftText = expectedDraftText,
                    expectedButtonLabel = expectedButtonLabel,
                    context = "after filling $context"
                )
                return
            } catch (error: AssertionError) {
                val shouldRetry =
                    attemptIndex == 0
                        && aiComposerDraftTextOrNull().isNullOrBlank()
                        && currentBlockingSystemDialogSummaryOrNull() == null
                        && visibleAppErrors().isEmpty()
                if (shouldRetry.not()) {
                    throw error
                }
            }
        }
    }

    private fun waitForGuestCloudWorkspaceReady(context: String) {
        try {
            waitUntilWithMitigation(
                timeoutMillis = externalUiTimeoutMillis,
                context = "while waiting for guest cloud workspace readiness $context"
            ) {
                val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
                val cloudSettings = runBlocking {
                    appGraph.cloudAccountRepository.observeCloudSettings().first()
                }
                val workspace = runBlocking {
                    appGraph.workspaceRepository.observeWorkspace().first()
                }
                cloudSettings.cloudState == CloudAccountState.GUEST
                    && cloudSettings.activeWorkspaceId != null
                    && workspace?.workspaceId == cloudSettings.activeWorkspaceId
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Guest cloud workspace was not ready $context. " +
                    "CloudSettings=${currentCloudSettingsSummary()} " +
                    "Workspace=${currentWorkspaceSummaryOrNull()} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun waitForAiComposerReady(
        expectedDraftText: String,
        expectedButtonLabel: String,
        context: String
    ) {
        try {
            waitUntilWithMitigation(
                timeoutMillis = externalUiTimeoutMillis,
                context = "while waiting for AI composer readiness $context"
            ) {
                aiComposerDraftTextOrNull() == expectedDraftText &&
                    aiComposerSendButtonIsEnabled(expectedLabel = expectedButtonLabel)
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "AI composer was not ready $context. " +
                    "ExpectedDraft='$expectedDraftText' " +
                    "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                    "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = expectedButtonLabel)} " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun waitForAssistantProposal(
        aiFrontText: String,
        aiBackText: String,
        markerTag: String
    ) {
        try {
            waitUntilWithMitigation(
                timeoutMillis = externalUiTimeoutMillis,
                context = "while waiting for the AI proposal"
            ) {
                val assistantText = latestAssistantMessageTextOrNull() ?: return@waitUntilWithMitigation false
                assistantText.contains(other = aiFrontText) &&
                    assistantText.contains(other = aiBackText) &&
                    assistantText.contains(other = markerTag)
            }
        } catch (error: Throwable) {
            throw AssertionError(
                "Assistant proposal did not contain the requested card. " +
                    "LatestAssistant='${latestAssistantMessageTextOrNull()}' " +
                    "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
                error
            )
        }
    }

    private fun aiComposerDraftTextOrNull(): String? {
        return composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.config
            ?.getOrNull(SemanticsProperties.EditableText)
            ?.text
    }

    private fun aiComposerFieldIsEditable(): Boolean {
        val node = composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
            .fetchSemanticsNodes()
            .singleOrNull() ?: return false
        return node.config.contains(SemanticsProperties.Disabled).not()
    }

    private fun aiComposerSendButtonIsEnabled(expectedLabel: String): Boolean {
        val node = composeRule.onAllNodes(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText(expectedLabel))
        ).fetchSemanticsNodes().singleOrNull() ?: return false
        return node.config.contains(SemanticsProperties.Disabled).not()
    }

    private fun aiComposerSendButtonStateOrNull(expectedLabel: String): String? {
        val node = composeRule.onAllNodes(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText(expectedLabel))
        ).fetchSemanticsNodes().singleOrNull() ?: return null
        return if (node.config.contains(SemanticsProperties.Disabled)) {
            "disabled"
        } else {
            "enabled"
        }
    }

    private fun latestAssistantMessageTextOrNull(): String? {
        return composeRule.onAllNodesWithTag(aiAssistantTextPartTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .map(::nodeSummary)
            .filter { text -> text.isNotBlank() }
            .takeIf { texts -> texts.isNotEmpty() }
            ?.joinToString(separator = " | ")
    }

    private fun visibleCardsFrontTexts(): List<String> {
        return composeRule.onAllNodesWithTag(cardsCardFrontTextTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .map(::nodeSummary)
            .filter { text -> text.isNotBlank() }
    }

    private fun currentReviewCardFrontTextOrNull(): String? {
        return composeRule.onAllNodesWithTag(reviewCurrentCardFrontContentTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun reviewEmptyStateTitleOrNull(): String? {
        return composeRule.onAllNodesWithTag(reviewEmptyStateTitleTag, useUnmergedTree = true)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun localCardSnapshotOrNull(expectedFrontText: String): String? {
        return runBlocking {
            val database = (composeRule.activity.application as FlashcardsApplication).appGraph.database
            val matchingCard = database.cardDao()
                .observeCardsWithRelations()
                .first()
                .lastOrNull { cardWithRelations ->
                    cardWithRelations.card.frontText == expectedFrontText
                } ?: return@runBlocking null
            "cardId=${matchingCard.card.cardId} " +
                "workspaceId=${matchingCard.card.workspaceId} " +
                "dueAtMillis=${matchingCard.card.dueAtMillis} " +
                "fsrsCardState=${matchingCard.card.fsrsCardState} " +
                "reps=${matchingCard.card.reps} " +
                "lapses=${matchingCard.card.lapses} " +
                "tags=${matchingCard.tags.map { tag -> tag.name }}"
        }
    }

    private fun currentCloudSettingsSummary(): String {
        return runBlocking {
            val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
            val cloudSettings = appGraph.cloudAccountRepository.observeCloudSettings().first()
            "cloudState=${cloudSettings.cloudState} " +
                "linkedUserId=${cloudSettings.linkedUserId} " +
                "linkedWorkspaceId=${cloudSettings.linkedWorkspaceId} " +
                "activeWorkspaceId=${cloudSettings.activeWorkspaceId} " +
                "installationId=${cloudSettings.installationId}"
        }
    }

    private fun currentWorkspaceSummaryOrNull(): String? {
        return runBlocking {
            val appGraph = (composeRule.activity.application as FlashcardsApplication).appGraph
            appGraph.workspaceRepository.observeWorkspace().first()?.let { workspace ->
                "workspaceId=${workspace.workspaceId} name=${workspace.name}"
            }
        }
    }

    private fun isDeletePreviewDialogVisible(): Boolean {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewDialogTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }

    private fun deletePreviewBodyTextOrNull(): String? {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeletePreviewBodyTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun isDeleteConfirmationDialogVisible(): Boolean {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationDialogTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }

    private fun deleteConfirmationPhraseOrNull(): String? {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationPhraseTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun deleteConfirmationErrorOrNull(): String? {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationErrorTag)
            .fetchSemanticsNodes()
            .singleOrNull()
            ?.let(::nodeSummary)
    }

    private fun isDeleteConfirmationLoadingVisible(): Boolean {
        return composeRule.onAllNodesWithTag(workspaceOverviewDeleteConfirmationLoadingTag)
            .fetchSemanticsNodes()
            .isNotEmpty()
    }

    private fun dismissExternalSystemDialogIfPresent(): String? {
        val summary = currentBlockingSystemDialogSummaryOrNull() ?: return null
        val waitButton = device.findObject(By.text(systemDialogWaitButtonText)) ?: return summary
        if (device.findObject(By.text(systemDialogCloseAppButtonText)) == null) {
            return summary
        }
        waitButton.click()
        device.waitForIdle()
        return summary
    }

    private fun currentBlockingSystemDialogSummaryOrNull(): String? {
        val dialogTitle = blockingSystemDialogTitles.firstNotNullOfOrNull { title ->
            if (device.findObject(By.text(title)) != null) {
                title
            } else {
                null
            }
        }
        val dialogMessage = device.findObject(By.textContains("isn't responding"))?.text
        val waitButtonVisible = device.findObject(By.text(systemDialogWaitButtonText)) != null
        val closeAppButtonVisible = device.findObject(By.text(systemDialogCloseAppButtonText)) != null
        if (waitButtonVisible.not() || closeAppButtonVisible.not()) {
            return null
        }
        return listOfNotNull(dialogTitle, dialogMessage).joinToString(separator = " | ").ifBlank {
            "external_system_dialog"
        }
    }

    private fun runShellCommand(command: String): String {
        val shellOutput = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        ParcelFileDescriptor.AutoCloseInputStream(shellOutput).use { inputStream ->
            BufferedReader(InputStreamReader(inputStream)).use { reader ->
                return reader.readText()
            }
        }
    }

    private fun scrollToText(text: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
    }
}
