package com.flashcardsopensourceapp.app

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.feature.ai.aiAssistantMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.aiAssistantTextPartTag
import com.flashcardsopensourceapp.feature.ai.aiComposerMessageFieldTag
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiEmptyStateTag
import com.flashcardsopensourceapp.feature.ai.aiNewChatButtonTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.cards.cardsCardFrontTextTag
import com.flashcardsopensourceapp.feature.review.reviewCurrentCardFrontContentTag
import com.flashcardsopensourceapp.feature.review.reviewEmptyStateTitleTag
import com.flashcardsopensourceapp.feature.review.reviewRateGoodButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.UUID

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
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasClickAction().and(other = hasText("Save")),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickNode(
        matcher = hasClickAction().and(other = hasText("Save")),
        label = "Save card"
    )
    waitForTextToExist(
        text = "Search cards",
        substring = false,
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for cards search after saving a manual card"
    )
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for the saved manual card to appear"
    ) {
        visibleCardsFrontTexts().any { text -> text == frontText }
    }
}

internal fun LiveSmokeContext.rateVisibleReviewCardGood() {
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText("Show answer"),
        timeoutMillis = internalUiTimeoutMillis
    )
    clickTag(tag = reviewShowAnswerButtonTag, label = "Show answer")
    clickTag(tag = reviewRateGoodButtonTag, label = "Rate Good")
    waitUntilWithMitigation(
        timeoutMillis = internalUiTimeoutMillis,
        context = "while waiting for the review queue to advance"
    ) {
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

private const val aiCreatePromptText: String =
    "I give you all permissions. Please create one test flashcard now."
private const val seededAiConversationUserText: String = "Show me the seeded smoke conversation."
private const val seededAiConversationAssistantText: String =
    "This seeded AI conversation is ready to reset."

internal fun LiveSmokeContext.createAiCardWithConfirmation() {
    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestCloudWorkspaceReady(context = "before filling the AI create prompt")
    waitForAiComposerButtonState(
        expectedLabel = "Send",
        expectedEnabled = false,
        context = "before filling the AI create prompt"
    )

    var latestCompletedSqlSummaries: List<String> = emptyList()
    repeat(times = 3) { attemptIndex ->
        val previousPersistedState: AiChatPersistedState = currentAiPersistedState()

        fillAiComposer(
            expectedDraftText = aiCreatePromptText,
            context = "for AI create attempt ${attemptIndex + 1}"
        )
        clickTag(tag = aiComposerSendButtonTag, label = "Send AI create prompt")
        waitForAiRunAcceptedOrCompleted(
            previousPersistedState = previousPersistedState,
            context = "for AI create attempt ${attemptIndex + 1}"
        )
        waitForAiComposerButtonState(
            expectedLabel = "Send",
            expectedEnabled = false,
            context = "after AI create attempt ${attemptIndex + 1} completed"
        )

        val toolCallCheck: LiveSmokeAiToolCallCheck = completedAiInsertToolCallCheck()
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
    previousPersistedState: AiChatPersistedState,
    context: String
) {
    try {
        waitForAiPersistedState(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for AI run acceptance $context"
        ) { state ->
            state.chatSessionId != previousPersistedState.chatSessionId ||
                completedAiInsertToolCallCheck(state = state).completedSqlSummaries.isNotEmpty() ||
                state.messages.size > previousPersistedState.messages.size
        }
    } catch (error: Throwable) {
        throw AssertionError(
            "AI run was not accepted $context. " +
                "ActualDraft='${aiComposerDraftTextOrNull()}' " +
                "SendState=${aiComposerSendButtonStateOrNull(expectedLabel = "Send")} " +
                "PersistedState=${currentAiPersistedStateSummary()} " +
                "SystemDialog=${currentBlockingSystemDialogSummaryOrNull()}",
            error
        )
    }
}

internal fun LiveSmokeContext.startNewChatAndAssertConversationReset() {
    clickTag(tag = aiNewChatButtonTag, label = "New chat")
    try {
        waitForAiPersistedState(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for New chat to reset the AI conversation"
        ) { state ->
            state.messages.isEmpty()
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
        waitForAiComposerButtonState(
            expectedLabel = "Send",
            expectedEnabled = false,
            context = "after resetting the AI conversation"
        )
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

internal fun LiveSmokeContext.seedGuestAiConversation() {
    val application = composeRule.activity.application as FlashcardsApplication
    val appGraph = application.appGraph
    val applicationContext = application.applicationContext
    val aiChatPreferencesStore = AiChatPreferencesStore(context = applicationContext)
    val aiChatHistoryStore = AiChatHistoryStore(context = applicationContext)
    val currentTimeMillis: Long = System.currentTimeMillis()

    runBlocking {
        appGraph.ensureLocalWorkspaceShell(currentTimeMillis = currentTimeMillis)
        val workspace = requireNotNull(appGraph.workspaceRepository.observeWorkspace().first()) {
            "Local workspace was missing while seeding the AI reset conversation."
        }

        aiChatPreferencesStore.updateConsent(hasConsent = true)
        aiChatHistoryStore.saveState(
            workspaceId = workspace.workspaceId,
            state = AiChatPersistedState(
                messages = listOf(
                    AiChatMessage(
                        messageId = UUID.randomUUID().toString().lowercase(),
                        role = AiChatRole.USER,
                        content = listOf(AiChatContentPart.Text(text = seededAiConversationUserText)),
                        timestampMillis = currentTimeMillis,
                        isError = false
                    ),
                    AiChatMessage(
                        messageId = UUID.randomUUID().toString().lowercase(),
                        role = AiChatRole.ASSISTANT,
                        content = listOf(AiChatContentPart.Text(text = seededAiConversationAssistantText)),
                        timestampMillis = currentTimeMillis,
                        isError = false
                    )
                ),
                chatSessionId = UUID.randomUUID().toString().lowercase(),
                lastKnownChatConfig = defaultAiChatServerConfig
            )
        )
    }

    composeRule.waitForIdle()
}

internal fun LiveSmokeContext.assertSeededAiConversationLoaded() {
    openAiTab()
    dismissAiConsentIfNeeded()
    waitForGuestCloudWorkspaceReady(context = "before verifying the seeded AI conversation")
    waitForAiConversation(
        expectedUserText = seededAiConversationUserText,
        expectedAssistantText = seededAiConversationAssistantText,
        context = "while waiting for the seeded AI conversation to materialize"
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
        val appGraph = appGraph()
        waitForFlowValue(
            timeoutMillis = externalUiTimeoutMillis,
            context = "while waiting for guest cloud workspace readiness $context",
            flow = combine(
                appGraph.cloudAccountRepository.observeCloudSettings(),
                appGraph.workspaceRepository.observeWorkspace()
            ) { cloudSettings, workspace ->
                cloudSettings to workspace
            }
        ) { (cloudSettings, workspace) ->
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
