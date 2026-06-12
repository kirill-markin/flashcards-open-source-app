package com.flashcardsopensourceapp.app.livesmoke.support

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.countNodesWithTagInAnySemanticsTree
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.currentBlockingSystemDialogSummaryOrNull
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.dismissExternalSystemDialogIfPresent
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.hasVisibleText
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.nodeSummary
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForFlowValue
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToDisappear
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToExist
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilAtLeastOneExistsOrFail
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilWithMitigation
import com.flashcardsopensourceapp.app.livesmoke.flows.dismissAiConsentIfNeeded
import com.flashcardsopensourceapp.app.livesmoke.flows.openAiTab
import com.flashcardsopensourceapp.data.local.ai.store.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.store.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRole
import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiConversationLoadingTag
import com.flashcardsopensourceapp.feature.ai.aiConversationSurfaceTag
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateTag
import com.flashcardsopensourceapp.feature.ai.aiNewChatButtonTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.R as AiFeatureR
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private const val aiCreatePromptText: String =
    "Create exactly one flashcard with frontText \"What is the smoke test AI card?\" " +
        "and backText \"The smoke test AI card was created successfully.\"; I approve the create operation; do not ask a follow-up."
private const val aiResetPromptText: String =
    "Please reply with one short sentence so I can verify this chat resets."

internal fun LiveSmokeContext.createAiCardWithConfirmation() {
    val sendLabel = aiSendLabel()
    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestAiEntryReady(
        expectedLabel = sendLabel,
        context = "before filling the AI create prompt"
    )

    var latestCompletedSqlSummaries: List<String> = emptyList()
    var latestAttemptError: Throwable? = null
    repeat(times = 3) { attemptIndex ->
        try {
            fillAiComposer(
                expectedDraftText = aiCreatePromptText,
                context = "for AI create attempt ${attemptIndex + 1}"
            )
            clickTag(tag = aiComposerSendButtonTag, label = "Send AI create prompt")
            waitForAiUserMessageVisible(
                expectedUserText = aiCreatePromptText,
                context = "for AI create attempt ${attemptIndex + 1}"
            )
            waitForAiComposerIdleAfterRun(
                context = "after AI create attempt ${attemptIndex + 1} completed"
            )

            val toolCallCheck: LiveSmokeAiToolCallCheck = completedAiInsertToolCallCheck()
            latestCompletedSqlSummaries = toolCallCheck.completedSqlSummaries
            if (toolCallCheck.matchingInsertFound) {
                return
            }
        } catch (error: Throwable) {
            latestAttemptError = error
        }
    }

    if (latestAttemptError != null && latestCompletedSqlSummaries.isEmpty()) {
        throw AssertionError(
            "AI create flow did not complete successfully after 3 attempts.",
            latestAttemptError
        )
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

private fun LiveSmokeContext.waitForAiUserMessageVisible(
    expectedUserText: String,
    context: String
) {
    try {
        waitForAiPersistedState(
            timeoutMillis = externalAiRunTimeoutMillis,
            context = "while waiting for the AI persisted history to record the user message $context"
        ) { state ->
            state.containsUserText(expectedUserText = expectedUserText)
        }
        waitForTagToExist(
            tag = aiUserMessageBubbleTag,
            timeoutMillis = externalAiRunTimeoutMillis,
            context = "while waiting for a user AI message $context"
        )
    } catch (error: Throwable) {
        throw AssertionError(
            "AI user message did not appear $context. " +
                "ExpectedUser='$expectedUserText' " +
                "PersistedState=${currentAiPersistedStateSummary()} " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = aiSendLabel())} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.startNewChatAndAssertConversationReset() {
    val sendLabel = aiSendLabel()
    val previousPersistedState = currentAiPersistedState()
    waitForEnabledTag(
        tag = aiNewChatButtonTag,
        label = "New chat",
        context = "before resetting the AI conversation"
    )
    clickTag(tag = aiNewChatButtonTag, label = "New chat")
    try {
        waitForAiPersistedState(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for New chat to reset the AI conversation"
        ) { state ->
            state.messages.isEmpty()
                && state.chatSessionId.isNotBlank()
                && state.chatSessionId != previousPersistedState.chatSessionId
        }
        waitForTagToExist(
            tag = aiEmptyStateTag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for the AI empty state after resetting the conversation"
        )
        waitForTagToDisappear(
            tag = aiAssistantMessageBubbleTag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for assistant messages to disappear after resetting the conversation"
        )
        waitForTagToDisappear(
            tag = aiUserMessageBubbleTag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "while waiting for user messages to disappear after resetting the conversation"
        )
        waitForAiComposerInitialState(
            expectedLabel = sendLabel,
            context = "after resetting the AI conversation"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for New chat to be disabled after resetting the conversation"
        ) {
            tagIsEnabled(tag = aiNewChatButtonTag).not()
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "New chat did not reset the AI conversation. " +
                "PreviousSessionId=${previousPersistedState.chatSessionId} " +
                "EmptyStateVisible=${composeRule.onAllNodesWithTag(aiEmptyStateTag).fetchSemanticsNodes().isNotEmpty()} " +
                "AssistantMessages=${countNodesWithTagInAnySemanticsTree(tag = aiAssistantMessageBubbleTag)} " +
                "UserMessages=${countNodesWithTagInAnySemanticsTree(tag = aiUserMessageBubbleTag)} " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "PersistedState=${currentAiPersistedStateSummary()} " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = sendLabel)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.createGuestAiConversationForReset() {
    val sendLabel = aiSendLabel()
    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestAiEntryReady(
        expectedLabel = sendLabel,
        context = "before filling the AI reset prompt"
    )

    fillAiComposer(
        expectedDraftText = aiResetPromptText,
        context = "for the AI reset conversation"
    )
    clickTag(tag = aiComposerSendButtonTag, label = "Send AI reset prompt")
    waitForAiUserMessageVisible(
        expectedUserText = aiResetPromptText,
        context = "for the AI reset conversation"
    )
    waitForEnabledTag(
        tag = aiNewChatButtonTag,
        label = "New chat",
        context = "after the AI reset conversation completed"
    )
    waitForAiComposerIdleAfterRun(
        context = "after the AI reset conversation completed"
    )
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
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = aiSendLabel())} " +
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
    val filled: Boolean = tryFillAiComposerWithTextInput(
        expectedDraftText = expectedDraftText,
        context = context
    ) || tryFillAiComposerWithTextReplacement(
        expectedDraftText = expectedDraftText,
        context = context
    ) || tryFillAiComposerWithTextInput(
        expectedDraftText = expectedDraftText,
        context = "$context after replacement fallback"
    )
    if (filled.not()) {
        throw AssertionError(
            "AI composer was not ready after filling $context. " +
                "ExpectedDraft='$expectedDraftText' " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = aiSendLabel())} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}"
        )
    }
}

private fun LiveSmokeContext.tryFillAiComposerWithTextInput(
    expectedDraftText: String,
    context: String
): Boolean {
    val composerField = composeRule.onNodeWithTag(aiComposerMessageFieldTag)
    return try {
        composerField.performClick()
        composeRule.waitForIdle()
        composerField.performTextClearance()
        composeRule.waitForIdle()
        composerField.performTextInput(expectedDraftText)
        waitForAiComposerReadyQuickly(
            expectedDraftText = expectedDraftText,
            context = "$context via performTextInput"
        )
        true
    } catch (_: Throwable) {
        false
    }
}

private fun LiveSmokeContext.tryFillAiComposerWithTextReplacement(
    expectedDraftText: String,
    context: String
): Boolean {
    val composerField = composeRule.onNodeWithTag(aiComposerMessageFieldTag)
    return try {
        composerField.performClick()
        composeRule.waitForIdle()
        composerField.performTextClearance()
        composeRule.waitForIdle()
        composerField.performTextReplacement(expectedDraftText)
        waitForAiComposerReadyQuickly(
            expectedDraftText = expectedDraftText,
            context = "$context via performTextReplacement"
        )
        true
    } catch (_: Throwable) {
        false
    }
}

private fun LiveSmokeContext.waitForAiComposerReadyQuickly(
    expectedDraftText: String,
    context: String
) {
    composeRule.waitUntil(timeoutMillis = internalUiTimeoutMillis) {
        aiComposerDraftTextOrNull() == expectedDraftText &&
            aiComposerSendButtonMatchesState(
                expectedLabel = aiSendLabel(),
                expectedEnabled = true
            )
    }
}

private data class GuestAiEntryReadinessSnapshot(
    val cloudState: CloudAccountState,
    val activeWorkspaceId: String?,
    val workspaceId: String?,
    val workspaceName: String?,
    val conversationLoadingVisible: Boolean,
    val conversationSurfaceVisible: Boolean,
    val composerEditable: Boolean,
    val sendButtonIdle: Boolean,
    val sendButtonState: String?
)

private fun LiveSmokeContext.waitForGuestAiEntryReady(
    expectedLabel: String,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalAiRunTimeoutMillis,
            context = "while waiting for guest AI entry readiness $context"
        ) {
            val snapshot = currentGuestAiEntryReadinessSnapshot(expectedLabel = expectedLabel)
            snapshot.cloudState == CloudAccountState.GUEST &&
                snapshot.activeWorkspaceId != null &&
                snapshot.workspaceId == snapshot.activeWorkspaceId &&
                snapshot.conversationLoadingVisible.not() &&
                snapshot.conversationSurfaceVisible &&
                snapshot.composerEditable &&
                snapshot.sendButtonIdle
        }
    } catch (error: Throwable) {
        val snapshot = currentGuestAiEntryReadinessSnapshot(expectedLabel = expectedLabel)
        throw AssertionError(
            "Guest AI entry did not become ready $context. " +
                "CloudState=${snapshot.cloudState} " +
                "ActiveWorkspaceId=${snapshot.activeWorkspaceId} " +
                "WorkspaceId=${snapshot.workspaceId} " +
                "WorkspaceName=${snapshot.workspaceName} " +
                "LoadingVisible=${snapshot.conversationLoadingVisible} " +
                "ConversationSurfaceVisible=${snapshot.conversationSurfaceVisible} " +
                "ComposerEditable=${snapshot.composerEditable} " +
                "SendState=${snapshot.sendButtonState} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.currentGuestAiEntryReadinessSnapshot(
    expectedLabel: String
): GuestAiEntryReadinessSnapshot {
    val appGraph: AppGraph = appGraph()
    val cloudSettings = runBlocking {
        appGraph.cloudAccountRepository.observeCloudSettings().first()
    }
    val workspace = runBlocking {
        appGraph.workspaceRepository.observeWorkspace().first()
    }
    return GuestAiEntryReadinessSnapshot(
        cloudState = cloudSettings.cloudState,
        activeWorkspaceId = cloudSettings.activeWorkspaceId,
        workspaceId = workspace?.workspaceId,
        workspaceName = workspace?.name,
        conversationLoadingVisible = countNodesWithTagInAnySemanticsTree(
            tag = aiConversationLoadingTag
        ) > 0,
        conversationSurfaceVisible = countNodesWithTagInAnySemanticsTree(
            tag = aiConversationSurfaceTag
        ) > 0,
        composerEditable = aiComposerFieldIsEditable(),
        sendButtonIdle = aiComposerSendButtonMatchesState(
            expectedLabel = expectedLabel,
            expectedEnabled = false
        ),
        sendButtonState = aiComposerSendButtonStateOrNull(expectedLabel = expectedLabel)
    )
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
                aiComposerSendButtonMatchesState(
                    expectedLabel = expectedButtonLabel,
                    expectedEnabled = true
                )
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

private fun LiveSmokeContext.waitForAiComposerButtonState(
    expectedLabel: String,
    expectedEnabled: Boolean,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for AI composer button state $context"
        ) {
            aiComposerSendButtonMatchesState(
                expectedLabel = expectedLabel,
                expectedEnabled = expectedEnabled
            )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI composer button was not in the expected state $context. " +
                "ExpectedLabel='$expectedLabel' " +
                "ExpectedEnabled=$expectedEnabled " +
                "ActualState=${aiComposerSendButtonStateOrNull(expectedLabel = expectedLabel)} " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForAiComposerInitialState(
    expectedLabel: String,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for the AI composer to return to its initial state $context"
        ) {
            aiComposerFieldIsEditable() &&
                aiComposerDraftTextOrNull().isNullOrBlank() &&
                aiComposerSendButtonMatchesState(
                    expectedLabel = expectedLabel,
                    expectedEnabled = false
                )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI composer did not return to its initial state $context. " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = expectedLabel)} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForAiComposerIdleAfterRun(context: String) {
    val sendLabel = aiSendLabel()
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalAiRunTimeoutMillis,
            context = "while waiting for the AI composer to return to idle $context"
        ) {
            aiComposerFieldIsEditable() &&
                aiComposerSendButtonMatchesState(
                    expectedLabel = sendLabel,
                    expectedEnabled = false
                )
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI composer did not return to idle $context. " +
                "ActualState=${aiComposerSendButtonStateOrNull(expectedLabel = sendLabel)} " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.waitForEnabledTag(
    tag: String,
    label: String,
    context: String
) {
    try {
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for $label to become enabled $context"
        ) {
            tagIsEnabled(tag = tag)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "$label was not enabled $context. " +
                "PersistedState=${currentAiPersistedStateSummary()} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

private fun LiveSmokeContext.completedAiInsertToolCallCheck(): LiveSmokeAiToolCallCheck {
    return completedAiInsertToolCallCheck(state = currentAiPersistedState())
}

private fun completedAiInsertToolCallCheck(state: AiChatPersistedState): LiveSmokeAiToolCallCheck {
    val completedToolCalls = state.messages
        .flatMap { message -> message.content }
        .mapNotNull { part ->
            if (part is AiChatContentPart.ToolCall) {
                part.toolCall
            } else {
                null
            }
        }
        .filter { toolCall -> toolCall.status == AiChatToolCallStatus.COMPLETED }
    val completedSqlSummaries: List<String> = completedToolCalls.map { toolCall ->
        listOfNotNull(
            toolCall.name.takeIf { name -> name.isNotBlank() },
            toolCall.input?.takeIf { input -> input.isNotBlank() },
            toolCall.output?.takeIf { output -> output.isNotBlank() }
        ).joinToString(separator = " | ")
    }.filter { summary -> summary.isNotBlank() }
    val summaryMatch: Boolean = completedSqlSummaries.any { summaryText ->
        summaryText.contains(other = "INSERT INTO cards")
    }
    val requestMatch: Boolean = completedToolCalls.any { toolCall ->
        toolCall.input?.contains(other = "INSERT INTO cards") == true
    }
    val responseMatch: Boolean = completedToolCalls.any { toolCall ->
        toolCall.output?.contains(other = "\"ok\":true") == true
    }
    val matchingInsertFound: Boolean = summaryMatch && requestMatch && responseMatch

    return LiveSmokeAiToolCallCheck(
        matchingInsertFound = matchingInsertFound,
        completedSqlSummaries = completedSqlSummaries
    )
}

private fun AiChatPersistedState.containsUserText(expectedUserText: String): Boolean {
    return messages.any { message ->
        message.role == AiChatRole.USER && message.content.any { contentPart ->
            contentPart is AiChatContentPart.Text && contentPart.text == expectedUserText
        }
    }
}

private fun LiveSmokeContext.waitForAiConversation(
    expectedUserText: String,
    expectedAssistantText: String,
    context: String
) {
    try {
        waitForTagToExist(
            tag = aiUserMessageBubbleTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for a user AI message $context"
        )
        waitForTagToExist(
            tag = aiAssistantMessageBubbleTag,
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for an assistant AI message $context"
        )
        waitUntilWithMitigation(
            timeoutMillis = externalUiTimeoutMillis,
            context = context
        ) {
            val assistantText: String? = latestAssistantMessageTextOrNull()
            hasVisibleText(text = expectedUserText, substring = false) &&
                (assistantText?.contains(other = expectedAssistantText) == true)
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI conversation did not materialize as expected. " +
                "ExpectedUser='$expectedUserText' " +
                "ExpectedAssistant='$expectedAssistantText' " +
                "LatestAssistant='${latestAssistantMessageTextOrNull()}' " +
                "UserMessages=${countNodesWithTagInAnySemanticsTree(tag = aiUserMessageBubbleTag)} " +
                "AssistantMessages=${countNodesWithTagInAnySemanticsTree(tag = aiAssistantMessageBubbleTag)} " +
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
        matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasContentDescription(expectedLabel))
    ).fetchSemanticsNodes().singleOrNull() ?: return false
    return node.config.contains(SemanticsProperties.Disabled).not()
}

private fun LiveSmokeContext.aiComposerSendButtonMatchesState(
    expectedLabel: String,
    expectedEnabled: Boolean
): Boolean {
    val isEnabled = aiComposerSendButtonIsEnabled(expectedLabel = expectedLabel)
    return if (expectedEnabled) {
        isEnabled
    } else {
        aiComposerSendButtonStateOrNull(expectedLabel = expectedLabel) == "disabled"
    }
}

private fun LiveSmokeContext.aiComposerSendButtonStateOrNull(expectedLabel: String): String? {
    val node = composeRule.onAllNodes(
        matcher = hasTestTag(aiComposerSendButtonTag).and(other = hasContentDescription(expectedLabel))
    ).fetchSemanticsNodes().singleOrNull() ?: return null
    return if (node.config.contains(SemanticsProperties.Disabled)) {
        "disabled"
    } else {
        "enabled"
    }
}

private fun LiveSmokeContext.tagIsEnabled(tag: String): Boolean {
    val node = composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().singleOrNull() ?: return false
    return node.config.contains(SemanticsProperties.Disabled).not()
}

private fun LiveSmokeContext.latestAssistantMessageTextOrNull(): String? {
    return composeRule.onAllNodesWithTag(aiAssistantTextPartTag, useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map(::nodeSummary)
        .filter { text -> text.isNotBlank() }
        .takeIf { texts -> texts.isNotEmpty() }
        ?.joinToString(separator = " | ")
}

private fun LiveSmokeContext.aiSendLabel(): String {
    return composeRule.activity.getString(AiFeatureR.string.ai_send)
}

private fun LiveSmokeContext.currentWorkspaceIdOrThrow(context: String): String {
    return runBlocking {
        requireNotNull(appGraph().workspaceRepository.observeWorkspace().first()?.workspaceId) {
            "Workspace ID was missing $context."
        }
    }
}

private fun LiveSmokeContext.aiHistoryStore(): AiChatHistoryStore {
    return AiChatHistoryStore(context = composeRule.activity.applicationContext)
}

private fun LiveSmokeContext.currentAiHistoryWorkspaceId(context: String): String {
    val workspaceId = currentWorkspaceIdOrThrow(context = context)
    val cloudSettings = runBlocking {
        appGraph().cloudAccountRepository.observeCloudSettings().first()
    }
    return makeAiChatHistoryScopedWorkspaceId(
        workspaceId = workspaceId,
        cloudSettings = cloudSettings
    )
}

private fun LiveSmokeContext.currentAiPersistedState(): AiChatPersistedState {
    return runBlocking {
        aiHistoryStore().loadState(
            workspaceId = currentAiHistoryWorkspaceId(context = "while loading AI persisted state")
        )
    }
}

private fun LiveSmokeContext.currentAiPersistedStateSummary(): String {
    val state = currentAiPersistedState()
    val completedToolCalls = completedAiInsertToolCallCheck(state = state).completedSqlSummaries
    return "chatSessionId=${state.chatSessionId} messageCount=${state.messages.size} completedToolCalls=$completedToolCalls"
}

private fun LiveSmokeContext.waitForAiPersistedState(
    timeoutMillis: Long,
    context: String,
    predicate: (AiChatPersistedState) -> Boolean
): AiChatPersistedState {
    val workspaceId = currentAiHistoryWorkspaceId(context = context)
    return waitForFlowValue(
        timeoutMillis = timeoutMillis,
        context = context,
        flow = aiHistoryStore().observeState(workspaceId = workspaceId),
        predicate = predicate
    )
}
