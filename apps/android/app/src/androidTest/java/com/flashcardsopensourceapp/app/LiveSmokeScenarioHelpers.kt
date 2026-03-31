package com.flashcardsopensourceapp.app

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateTag
import com.flashcardsopensourceapp.feature.ai.aiNewChatButtonTag
import com.flashcardsopensourceapp.feature.ai.aiToolCallInputTag
import com.flashcardsopensourceapp.feature.ai.aiToolCallOutputTag
import com.flashcardsopensourceapp.feature.ai.aiToolCallStatusTag
import com.flashcardsopensourceapp.feature.ai.aiToolCallSummaryTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.cards.cardsCardFrontTextTag
import com.flashcardsopensourceapp.feature.review.reviewCurrentCardFrontContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTitleTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

internal fun LiveSmokeContext.withLinkedWorkspaceSession(
    reviewEmail: String,
    workspaceName: String,
    action: () -> Unit
) {
    var primaryFailure: Throwable? = null
    var shouldDeleteWorkspace: Boolean = false

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

internal fun LiveSmokeContext.createManualCard(
    frontText: String,
    backText: String,
    markerTag: String
) {
    openCardsTab()
    clickContentDescription(contentDescription = "Add card")
    updateCardText(fieldTitle = "Front", value = frontText)
    updateCardText(fieldTitle = "Back", value = backText)
    clickText(text = "Tags", substring = false)
    composeRule.onNodeWithText("Add a tag").performTextInput(markerTag)
    clickText(text = "Add tag", substring = false)
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

internal fun LiveSmokeContext.rateVisibleReviewCardGood() {
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Show answer"),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickTag(tag = reviewShowAnswerButtonTag, label = "Show answer")
    clickTag(tag = reviewRateGoodButtonTag, label = "Rate Good")
    composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
        failIfVisibleAppError(context = "while waiting for the review queue to advance")
        composeRule.onAllNodesWithTag(reviewShowAnswerButtonTag).fetchSemanticsNodes().isNotEmpty() ||
            composeRule.onAllNodesWithText("Session complete").fetchSemanticsNodes().isNotEmpty()
    }
}

internal fun LiveSmokeContext.seedLocalCard(
    frontText: String,
    backText: String,
    markerTag: String
) {
    val application = composeRule.activity.application as FlashcardsApplication
    val appGraph = application.appGraph
    runBlocking {
        appGraph.ensureLocalWorkspaceShell(currentTimeMillis = System.currentTimeMillis())
        appGraph.cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = frontText,
                backText = backText,
                tags = listOf(markerTag),
                effortLevel = EffortLevel.MEDIUM
            )
        )
    }
    composeRule.waitForIdle()
}

internal fun LiveSmokeContext.relaunchAndAssertAccountStatus(reviewEmail: String) {
    composeRule.activityRule.scenario.recreate()
    openSettingsTab()
    clickNode(
        matcher = hasText("Account").and(other = hasClickAction()),
        label = "Account"
    )
    clickText(text = "Account status", substring = false)
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText(reviewEmail),
        timeoutMillis = internalUiTimeoutMillis
    )
    tapBackIcon()
    tapBackIcon()
}

internal fun LiveSmokeContext.relaunchAndAssertGuestAccountStatus() {
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
    clickText(text = "Account status", substring = false)
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Guest AI"),
        timeoutMillis = internalUiTimeoutMillis
    )
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Guest AI session"),
        timeoutMillis = internalUiTimeoutMillis
    )
    if (hasVisibleText(text = "Linked", substring = false)) {
        throw AssertionError("Guest AI smoke unexpectedly reached a linked account state.")
    }
    tapBackIcon()
    tapBackIcon()
}

internal fun LiveSmokeContext.createAiCardWithConfirmation(
    aiFrontText: String,
    aiBackText: String,
    markerTag: String
) {
    val createPrompt: String =
        "Create exactly one flashcard now. " +
            "Use front text '$aiFrontText', back text '$aiBackText', and tag '$markerTag'. " +
            "You have my explicit permission to write data and execute the SQL insert now. " +
            "Do not ask follow-up questions if these details are sufficient."

    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestCloudWorkspaceReady(context = "before filling the AI create prompt")

    var latestCompletedSqlSummaries: List<String> = emptyList()
    repeat(times = 3) { attemptIndex ->
        val previousToolCallSummaryCount: Int = toolCallSummaryTexts().size

        fillAiComposer(
            expectedDraftText = createPrompt,
            context = "for AI create attempt ${attemptIndex + 1}"
        )
        clickTag(tag = aiComposerSendButtonTag, label = "Send AI create prompt")
        waitForAiRunAcceptedOrCompleted(
            expectedDraftText = createPrompt,
            previousToolCallSummaryCount = previousToolCallSummaryCount,
            context = "for AI create attempt ${attemptIndex + 1}"
        )
        waitUntilAtLeastOneExistsOrFail(
            matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText("Send")),
            timeoutMillis = externalUiTimeoutMillis
        )

        val toolCallCheck: LiveSmokeAiToolCallCheck = completedAiInsertToolCallCheck(
            aiFrontText = aiFrontText,
            markerTag = markerTag
        )
        latestCompletedSqlSummaries = toolCallCheck.completedSqlSummaries
        if (toolCallCheck.matchingInsertFound) {
            return
        }
    }

    throw AssertionError(
        "AI create flow did not produce a completed SQL INSERT INTO cards after 3 attempts. " +
            "CompletedSqlToolCalls=${latestCompletedSqlSummaries}"
    )
}

private data class LiveSmokeAiToolCallCheck(
    val matchingInsertFound: Boolean,
    val completedSqlSummaries: List<String>
)

private fun LiveSmokeContext.waitForAiRunAcceptedOrCompleted(
    expectedDraftText: String,
    previousToolCallSummaryCount: Int,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for AI run acceptance $context"
        ) {
            val stopVisible: Boolean = composeRule.onAllNodes(
                matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText("Stop"))
            ).fetchSemanticsNodes().isNotEmpty()
            val draftChanged: Boolean = aiComposerDraftTextOrNull() != expectedDraftText
            val toolCallProgressed: Boolean = toolCallSummaryTexts().size > previousToolCallSummaryCount
            stopVisible || draftChanged || toolCallProgressed
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI run was not accepted $context. " +
                "ExpectedDraft='$expectedDraftText' " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = "Send")} " +
                "ToolCallSummaries=${toolCallSummaryTexts()} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.startNewChatAndAssertConversationReset() {
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

internal fun LiveSmokeContext.createGuestAiConversation(
    promptText: String,
    expectedAssistantText: String
) {
    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestCloudWorkspaceReady(context = "before creating a guest AI conversation")
    fillAiComposer(
        expectedDraftText = promptText,
        context = "for the guest AI reset smoke prompt"
    )
    clickTag(tag = aiComposerSendButtonTag, label = "Send guest AI reset smoke prompt")
    waitForGuestConversation(
        expectedUserText = promptText,
        expectedAssistantText = expectedAssistantText
    )
}

internal fun LiveSmokeContext.assertCardVisibleInCards(searchText: String, timeoutMillis: Long) {
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

internal fun LiveSmokeContext.assertCardReachableInReview(
    expectedFrontText: String,
    timeoutMillis: Long
) {
    openReviewTab()
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

internal fun LiveSmokeContext.forceSyncAndWaitForLocalCard(
    expectedFrontText: String,
    timeoutMillis: Long
) {
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

internal fun LiveSmokeContext.assertLinkedAccountStatus(
    reviewEmail: String,
    workspaceName: String
) {
    openSettingsTab()
    composeRule.onNodeWithText("Current Workspace").fetchSemanticsNode()
    clickNode(
        matcher = hasText("Account").and(other = hasClickAction()),
        label = "Account"
    )
    clickText(text = "Account status", substring = false)
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

private fun LiveSmokeContext.waitForAiComposerEditable(context: String) {
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

private fun LiveSmokeContext.fillAiComposer(
    expectedDraftText: String,
    context: String
) {
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasTestTag(aiComposerMessageFieldTag),
        timeoutMillis = externalUiTimeoutMillis
    )
    dismissExternalSystemDialogIfPresent()
    waitForAiComposerEditable(context = "before filling $context")
    composeRule.onNodeWithTag(aiComposerMessageFieldTag).performClick()
    composeRule.waitForIdle()
    composeRule.onNodeWithTag(aiComposerMessageFieldTag).performTextReplacement(expectedDraftText)
    waitForAiComposerReady(
        expectedDraftText = expectedDraftText,
        expectedButtonLabel = "Send",
        context = "after filling $context"
    )
}

private fun LiveSmokeContext.waitForGuestCloudWorkspaceReady(context: String) {
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
            cloudSettings.cloudState == CloudAccountState.GUEST &&
                cloudSettings.activeWorkspaceId != null &&
                workspace?.workspaceId == cloudSettings.activeWorkspaceId
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

private fun LiveSmokeContext.waitForAiComposerReady(
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

private fun LiveSmokeContext.completedAiInsertToolCallCheck(
    aiFrontText: String,
    markerTag: String
): LiveSmokeAiToolCallCheck {
    expandAllToolCallDetails()

    val summaryTexts: List<String> = toolCallSummaryTexts()
    val statusTexts: List<String> = toolCallStatusTexts()
    val inputTexts: List<String> = toolCallInputTexts()
    val outputTexts: List<String> = toolCallOutputTexts()
    val completedSqlSummaries: List<String> = summaryTexts.filterIndexed { index, summaryText ->
        val statusText: String = statusTexts.getOrNull(index) ?: ""
        summaryText.contains(other = "SQL:") && statusText == "Done"
    }
    val matchingInsertFound: Boolean = completedSqlSummaries.any { summaryText ->
        summaryText.contains(other = "INSERT INTO cards") &&
            summaryText.contains(other = aiFrontText) &&
            summaryText.contains(other = markerTag)
    } && inputTexts.any { inputText ->
        inputText.contains(other = "INSERT INTO cards") &&
            inputText.contains(other = aiFrontText) &&
            inputText.contains(other = markerTag)
    } && outputTexts.any { outputText ->
        outputText.contains(other = "\"ok\":true")
    }

    return LiveSmokeAiToolCallCheck(
        matchingInsertFound = matchingInsertFound,
        completedSqlSummaries = completedSqlSummaries
    )
}

private fun LiveSmokeContext.expandAllToolCallDetails() {
    while (composeRule.onAllNodesWithContentDescription("Expand tool details").fetchSemanticsNodes().isNotEmpty()) {
        composeRule.onAllNodesWithContentDescription("Expand tool details")[0].performClick()
        composeRule.waitForIdle()
    }
}

private fun LiveSmokeContext.waitForGuestConversation(
    expectedUserText: String,
    expectedAssistantText: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the guest AI conversation to materialize"
        ) {
            val userMessagesVisible: Boolean =
                composeRule.onAllNodesWithTag(aiUserMessageBubbleTag).fetchSemanticsNodes().isNotEmpty()
            val assistantMessagesVisible: Boolean =
                composeRule.onAllNodesWithTag(aiAssistantMessageBubbleTag).fetchSemanticsNodes().isNotEmpty()
            val assistantText: String? = latestAssistantMessageTextOrNull()
            userMessagesVisible &&
                assistantMessagesVisible &&
                hasVisibleText(text = expectedUserText, substring = false) &&
                (assistantText?.contains(other = expectedAssistantText) == true)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "Guest AI conversation did not materialize as expected. " +
                "ExpectedUser='$expectedUserText' " +
                "ExpectedAssistant='$expectedAssistantText' " +
                "LatestAssistant='${latestAssistantMessageTextOrNull()}' " +
                "UserMessages=${composeRule.onAllNodesWithTag(aiUserMessageBubbleTag).fetchSemanticsNodes().size} " +
                "AssistantMessages=${composeRule.onAllNodesWithTag(aiAssistantMessageBubbleTag).fetchSemanticsNodes().size} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.aiComposerDraftTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.config
        ?.getOrNull(SemanticsProperties.EditableText)
        ?.text
}

private fun LiveSmokeContext.aiComposerFieldIsEditable(): Boolean {
    val node = composeRule.onAllNodesWithTag(aiComposerMessageFieldTag)
        .fetchSemanticsNodes()
        .singleOrNull() ?: return false
    return node.config.contains(SemanticsProperties.Disabled).not()
}

private fun LiveSmokeContext.aiComposerSendButtonIsEnabled(expectedLabel: String): Boolean {
    val node = composeRule.onAllNodes(
        matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText(expectedLabel))
    ).fetchSemanticsNodes().singleOrNull() ?: return false
    return node.config.contains(SemanticsProperties.Disabled).not()
}

private fun LiveSmokeContext.aiComposerSendButtonStateOrNull(expectedLabel: String): String? {
    val node = composeRule.onAllNodes(
        matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasText(expectedLabel))
    ).fetchSemanticsNodes().singleOrNull() ?: return null
    return if (node.config.contains(SemanticsProperties.Disabled)) {
        "disabled"
    } else {
        "enabled"
    }
}

private fun LiveSmokeContext.latestAssistantMessageTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(aiAssistantTextPartTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
        .takeIf { texts -> texts.isNotEmpty() }
        ?.joinToString(separator = " | ")
}

private fun LiveSmokeContext.toolCallSummaryTexts(): List<String> {
    return composeRule.onAllNodesWithTag(aiToolCallSummaryTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.toolCallStatusTexts(): List<String> {
    return composeRule.onAllNodesWithTag(aiToolCallStatusTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.toolCallInputTexts(): List<String> {
    return composeRule.onAllNodesWithTag(aiToolCallInputTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.toolCallOutputTexts(): List<String> {
    return composeRule.onAllNodesWithTag(aiToolCallOutputTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.visibleCardsFrontTexts(): List<String> {
    return composeRule.onAllNodesWithTag(cardsCardFrontTextTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
}

private fun LiveSmokeContext.currentReviewCardFrontTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(reviewCurrentCardFrontContentTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.reviewEmptyStateTitleOrNull(): String? {
    return composeRule.onAllNodesWithTag(reviewEmptyStateTitleTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .singleOrNull()
        ?.let(::nodeSummary)
}

private fun LiveSmokeContext.localCardSnapshotOrNull(expectedFrontText: String): String? {
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
