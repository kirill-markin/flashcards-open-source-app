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
import androidx.compose.ui.test.onRoot
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
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthExistingButtonTagPrefix
import com.flashcardsopensourceapp.feature.settings.cloudPostAuthSelectedIndicatorTagPrefix
import com.flashcardsopensourceapp.feature.settings.cloudSignInEmailFieldTag
import com.flashcardsopensourceapp.feature.settings.cloudSignInSendCodeButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceExistingButtonTagPrefix
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceListTag
import com.flashcardsopensourceapp.feature.settings.currentWorkspaceSelectedIndicatorTagPrefix
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspaceOverviewDeleteWorkspaceButtonTag
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
        private const val liveUiTimeoutMillis: Long = 120_000L
        private const val reviewEmailArgumentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
    }

    private data class WorkspaceListSnapshot(
        val rowsById: Map<String, String>,
        val selectedWorkspaceIds: Set<String>
    ) {
        fun describe(): String {
            return "rows=$rowsById selected=$selectedWorkspaceIds"
        }
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

        composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
            composeRule.onAllNodesWithText("Sync now").fetchSemanticsNodes().isNotEmpty()
                || captureCloudPostAuthWorkspaceSnapshot().rowsById.isNotEmpty()
                || composeRule.onAllNodesWithText("Preparing").fetchSemanticsNodes().isNotEmpty()
        }

        val postAuthSnapshot = captureCloudPostAuthWorkspaceSnapshot()
        if (postAuthSnapshot.rowsById.isNotEmpty()) {
            if (postAuthSnapshot.selectedWorkspaceIds.size > 1) {
                throw AssertionError(
                    "Cloud sync chooser exposed more than one selected workspace. ${postAuthSnapshot.describe()}"
                )
            }
            val selectedWorkspaceId = postAuthSnapshot.selectedWorkspaceIds.singleOrNull()
                ?: throw AssertionError(
                    "Cloud sync chooser remained ambiguous after loading linked workspaces. ${postAuthSnapshot.describe()}"
                )
            composeRule.onNodeWithTag(
                testTag = cloudPostAuthExistingButtonTagPrefix + selectedWorkspaceId
            ).performClick()
        }

        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Sync now"),
            timeoutMillis = liveUiTimeoutMillis
        )
        tapBackIcon()
        tapBackIcon()
    }

    private fun createEphemeralWorkspace(workspaceName: String) {
        openSettingsTab()
        composeRule.onNodeWithText("Current Workspace").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Create new workspace"),
            timeoutMillis = liveUiTimeoutMillis
        )
        waitForLinkedWorkspacesToLoad(context = "before creating a linked workspace")
        val workspaceSnapshotBeforeCreate = captureWorkspaceListSnapshot()
        assertSingleSelectedWorkspace(
            context = "before creating a linked workspace",
            snapshot = workspaceSnapshotBeforeCreate
        )
        val selectedWorkspaceIdBeforeCreate = workspaceSnapshotBeforeCreate.selectedWorkspaceIds.single()
        composeRule.onNodeWithTag(currentWorkspaceListTag).performScrollToNode(
            matcher = hasTestTag(currentWorkspaceCreateButtonTag)
        )
        composeRule.onNodeWithTag(currentWorkspaceCreateButtonTag).performClick()
        waitForWorkspaceListChange(
            label = "Current workspace did not switch to the newly created linked workspace",
            predicate = { snapshot ->
                snapshot.selectedWorkspaceIds.size == 1
                    && snapshot.selectedWorkspaceIds.single() != selectedWorkspaceIdBeforeCreate
            },
            beforeSnapshot = workspaceSnapshotBeforeCreate
        )
        tapBackIcon()

        openSettingsSection(sectionTitle = "Workspace")
        composeRule.onNodeWithText("Overview").performClick()
        composeRule.onNodeWithTag(workspaceOverviewNameFieldTag).performTextReplacement(workspaceName)
        composeRule.onNodeWithTag(workspaceOverviewSaveNameButtonTag).performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Workspace name saved."),
            timeoutMillis = liveUiTimeoutMillis
        )
        tapBackIcon()
        tapBackIcon()
        composeRule.onNodeWithText(workspaceName).fetchSemanticsNode()
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
            timeoutMillis = liveUiTimeoutMillis
        )
    }

    private fun reviewOneCard() {
        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Show answer"),
            timeoutMillis = liveUiTimeoutMillis
        )
        composeRule.onNodeWithTag(reviewShowAnswerButtonTag).performClick()
        composeRule.onNodeWithTag(reviewRateGoodButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
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
            timeoutMillis = liveUiTimeoutMillis
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
        composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
            composeRule.onAllNodesWithText(aiFrontText, substring = true).fetchSemanticsNodes().isNotEmpty()
                || composeRule.onAllNodesWithText(markerTag, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag(aiComposerMessageFieldTag).performTextReplacement(
            "Confirmed. Create the card exactly as proposed."
        )
        composeRule.onNodeWithTag(aiComposerSendButtonTag).performClick()
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText("Done"),
            timeoutMillis = liveUiTimeoutMillis
        )
    }

    private fun assertCardVisibleInCards(searchText: String) {
        openCardsTab()
        composeRule.onNodeWithText("Search cards").performTextReplacement(searchText)
        composeRule.waitUntilAtLeastOneExists(
            matcher = hasText(searchText),
            timeoutMillis = liveUiTimeoutMillis
        )
    }

    private fun assertReviewQueueLoads() {
        composeRule.onNodeWithText("Review").performClick()
        composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
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
            timeoutMillis = liveUiTimeoutMillis
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
            timeoutMillis = liveUiTimeoutMillis
        )
        waitForLinkedWorkspacesToLoad(context = "before deleting the isolated linked workspace")
        val workspaceSnapshotBeforeDelete = captureWorkspaceListSnapshot()
        if (workspaceSnapshotBeforeDelete.rowsById.isEmpty()) {
            tapBackIcon()
            return
        }
        assertSingleSelectedWorkspace(
            context = "before deleting the isolated linked workspace",
            snapshot = workspaceSnapshotBeforeDelete
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
        waitForWorkspaceListChange(
            label = "Deleted linked workspace still appears as the current workspace after delete",
            predicate = { snapshot ->
                snapshot.selectedWorkspaceIds.size == 1
                    && composeRule.onAllNodesWithText(workspaceName).fetchSemanticsNodes().isEmpty()
            },
            beforeSnapshot = workspaceSnapshotBeforeDelete
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
            timeoutMillis = liveUiTimeoutMillis
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

    private fun assertSingleSelectedWorkspace(context: String, snapshot: WorkspaceListSnapshot) {
        if (snapshot.selectedWorkspaceIds.size != 1) {
            throw AssertionError(
                "Expected exactly one selected workspace $context, but found ${snapshot.selectedWorkspaceIds.size}. ${snapshot.describe()}"
            )
        }
    }

    private fun waitForLinkedWorkspacesToLoad(context: String) {
        try {
            composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
                val snapshot = captureWorkspaceListSnapshot()
                snapshot.rowsById.isNotEmpty() && snapshot.selectedWorkspaceIds.size == 1
            }
        } catch (error: Throwable) {
            val snapshot = captureWorkspaceListSnapshot()
            throw AssertionError(
                "Linked workspaces did not finish loading $context. ${snapshot.describe()}",
                error
            )
        }
    }

    private fun waitForWorkspaceListChange(
        label: String,
        predicate: (WorkspaceListSnapshot) -> Boolean,
        beforeSnapshot: WorkspaceListSnapshot
    ) {
        try {
            composeRule.waitUntil(timeoutMillis = liveUiTimeoutMillis) {
                predicate(captureWorkspaceListSnapshot())
            }
        } catch (error: Throwable) {
            val afterSnapshot = captureWorkspaceListSnapshot()
            throw AssertionError(
                "$label. Before=${beforeSnapshot.describe()} After=${afterSnapshot.describe()}",
                error
            )
        }
    }

    private fun captureWorkspaceListSnapshot(): WorkspaceListSnapshot {
        return captureWorkspaceSnapshot(
            rowTagPrefix = currentWorkspaceExistingButtonTagPrefix,
            selectedIndicatorTagPrefix = currentWorkspaceSelectedIndicatorTagPrefix
        )
    }

    private fun captureCloudPostAuthWorkspaceSnapshot(): WorkspaceListSnapshot {
        return captureWorkspaceSnapshot(
            rowTagPrefix = cloudPostAuthExistingButtonTagPrefix,
            selectedIndicatorTagPrefix = cloudPostAuthSelectedIndicatorTagPrefix
        )
    }

    private fun captureWorkspaceSnapshot(
        rowTagPrefix: String,
        selectedIndicatorTagPrefix: String
    ): WorkspaceListSnapshot {
        composeRule.waitForIdle()
        val mergedNodes = flattenSemanticsNodes(
            node = composeRule.onRoot().fetchSemanticsNode()
        )
        val unmergedNodes = flattenSemanticsNodes(
            node = composeRule.onRoot(useUnmergedTree = true).fetchSemanticsNode()
        )
        val rowsById = mergedNodes.mapNotNull { node ->
            val tag = node.config.getOrNull(SemanticsProperties.TestTag) ?: return@mapNotNull null
            if (tag.startsWith(rowTagPrefix).not()) {
                return@mapNotNull null
            }
            val workspaceId = tag.removePrefix(rowTagPrefix)
            workspaceId to nodeSummary(node)
        }.toMap()
        val selectedWorkspaceIds = unmergedNodes.mapNotNull { node ->
            val tag = node.config.getOrNull(SemanticsProperties.TestTag) ?: return@mapNotNull null
            if (tag.startsWith(selectedIndicatorTagPrefix).not()) {
                return@mapNotNull null
            }
            tag.removePrefix(selectedIndicatorTagPrefix)
        }.toSet()

        return WorkspaceListSnapshot(
            rowsById = rowsById,
            selectedWorkspaceIds = selectedWorkspaceIds
        )
    }

    private fun flattenSemanticsNodes(node: SemanticsNode): List<SemanticsNode> {
        return listOf(node) + node.children.flatMap(::flattenSemanticsNodes)
    }

    private fun nodeSummary(node: SemanticsNode): String {
        val texts = node.config.getOrNull(SemanticsProperties.Text)
            ?.map { text -> text.text }
            ?.filter { text -> text.isNotBlank() }
            .orEmpty()
        return texts.joinToString(separator = " | ")
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
