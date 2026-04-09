package com.flashcardsopensourceapp.app

import android.content.ClipboardManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.feature.ai.AiRoute
import com.flashcardsopensourceapp.feature.ai.AiUiState
import com.flashcardsopensourceapp.feature.ai.aiComposerSendButtonTag
import com.flashcardsopensourceapp.feature.ai.aiUserMessageBubbleTag
import com.flashcardsopensourceapp.feature.ai.formatAiConsentWorkspaceDisclosureText
import com.flashcardsopensourceapp.feature.ai.R as AiFeatureR
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AiRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun consentGateShowsLegalLinksAndAcceptsConsent() {
        var consentRequired by mutableStateOf(value = true)
        val consentTitle = composeRule.activity.getString(AiFeatureR.string.ai_consent_title)
        val consentDisclosure = formatAiConsentWorkspaceDisclosureText(
            template = composeRule.activity.getString(AiFeatureR.string.ai_consent_workspace_disclosure),
            currentWorkspaceName = "Personal"
        )
        val privacyPolicy = composeRule.activity.getString(AiFeatureR.string.ai_privacy_policy)
        val termsOfService = composeRule.activity.getString(AiFeatureR.string.ai_terms_of_service)
        val support = composeRule.activity.getString(AiFeatureR.string.ai_support)
        val accept = composeRule.activity.getString(AiFeatureR.string.ai_consent_accept)
        val messageLabel = composeRule.activity.getString(AiFeatureR.string.ai_message_label)

        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(isConsentRequired = consentRequired),
                    onAcceptConsent = {
                        consentRequired = false
                    },
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText(consentTitle).assertIsDisplayed()
        composeRule.onNodeWithText(consentDisclosure).assertIsDisplayed()
        composeRule.onNodeWithText(privacyPolicy).assertIsDisplayed()
        composeRule.onNodeWithText(termsOfService).assertIsDisplayed()
        composeRule.onNodeWithText(support).assertIsDisplayed()
        composeRule.onNodeWithText(accept).performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isEmpty() &&
                composeRule.onAllNodesWithText(messageLabel).fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(composeRule.onAllNodesWithText(consentTitle).fetchSemanticsNodes().isEmpty())
        assertTrue(composeRule.onAllNodesWithText("Android AI").fetchSemanticsNodes().isEmpty())
        composeRule.onNodeWithText(messageLabel).assertIsDisplayed()
    }

    @Test
    fun toolCallDetailsExpandAndCopyOutput() {
        val toolOutput = "{\"rows\":[1]}"
        val expandDetails = composeRule.activity.getString(AiFeatureR.string.ai_tool_expand_details)
        val copyOutput = composeRule.activity.getString(AiFeatureR.string.ai_tool_copy_output)

        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        messages = listOf(
                            AiChatMessage(
                                messageId = "assistant-tool",
                                role = AiChatRole.ASSISTANT,
                                content = listOf(
                                    AiChatContentPart.ToolCall(
                                        toolCall = AiChatToolCall(
                                            toolCallId = "tool-1",
                                            name = "sql",
                                            status = AiChatToolCallStatus.COMPLETED,
                                            input = "{\"sql\":\"SELECT 1\"}",
                                            output = toolOutput
                                        )
                                    )
                                ),
                                timestampMillis = 1L,
                                isError = false,
                                isStopped = false,
                                cursor = null,
                                itemId = null
                            )
                        )
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithContentDescription(expandDetails).performClick()
        composeRule.onNodeWithText("{\"sql\":\"SELECT 1\"}").assertIsDisplayed()
        composeRule.onNodeWithText(toolOutput).assertIsDisplayed()
        composeRule.onNode(
            matcher = hasText(copyOutput).and(other = hasClickAction())
        ).performClick()

        val clipboardManager = composeRule.activity.getSystemService(ClipboardManager::class.java)
        assertTrue(clipboardManager != null)
    }

    @Test
    fun streamingComposerPrimaryActionShowsStop() {
        val stopLabel = composeRule.activity.getString(AiFeatureR.string.ai_stop)
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        messages = listOf(
                            AiChatMessage(
                                messageId = "assistant-streaming",
                                role = AiChatRole.ASSISTANT,
                                content = listOf(AiChatContentPart.Text(text = "Looking through your cards...")),
                                timestampMillis = 1L,
                                isError = false,
                                isStopped = false,
                                cursor = null,
                                itemId = null
                            )
                        ),
                        isStreaming = true,
                        canStopStreaming = true
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText(stopLabel).assertIsDisplayed()
        composeRule.onNodeWithTag(aiComposerSendButtonTag).assertIsEnabled()
    }

    @Test
    fun idleComposerPrimaryActionShowsDisabledSendWithoutDraft() {
        val sendLabel = composeRule.activity.getString(AiFeatureR.string.ai_send)
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText(sendLabel).assertIsDisplayed()
        composeRule.onNodeWithTag(aiComposerSendButtonTag).assertIsNotEnabled()
    }

    @Test
    fun idleComposerPrimaryActionEnablesSendWhenDraftExists() {
        val sendLabel = composeRule.activity.getString(AiFeatureR.string.ai_send)
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        draftMessage = "hello",
                        canSend = true
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText(sendLabel).assertIsDisplayed()
        composeRule.onNodeWithTag(aiComposerSendButtonTag).assertIsEnabled()
    }

    @Test
    fun shortUserMessageUsesCompactRightAlignedBubble() {
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        messages = listOf(
                            AiChatMessage(
                                messageId = "user-short",
                                role = AiChatRole.USER,
                                content = listOf(AiChatContentPart.Text(text = "hi")),
                                timestampMillis = 1L,
                                isError = false,
                                isStopped = false,
                                cursor = null,
                                itemId = null
                            )
                        )
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        val rootBounds = composeRule.onRoot().fetchSemanticsNode().boundsInRoot
        val bubbleBounds = composeRule
            .onNodeWithTag(aiUserMessageBubbleTag, useUnmergedTree = true)
            .fetchSemanticsNode()
            .boundsInRoot
        val rootCenterX = (rootBounds.left + rootBounds.right) / 2f

        assertTrue(bubbleBounds.width < rootBounds.width * 0.5f)
        assertTrue(bubbleBounds.left > rootCenterX)
    }

    @Test
    fun accountUpgradePromptNavigatesToAccountStatusDestination() {
        composeRule.setContent {
            FlashcardsTheme {
                val navController = rememberNavController()

                NavHost(
                    navController = navController,
                    startDestination = "ai"
                ) {
                    composable(route = "ai") {
                        AiRoute(
                            uiState = makeAiUiState(
                                messages = listOf(
                                    AiChatMessage(
                                        messageId = "assistant-upgrade",
                                        role = AiChatRole.ASSISTANT,
                                        content = listOf(
                                            AiChatContentPart.AccountUpgradePrompt(
                                                message = "Guest AI quota reached.",
                                                buttonTitle = "Open account status"
                                            )
                                        ),
                                        timestampMillis = 1L,
                                        isError = false,
                                        isStopped = false,
                                        cursor = null,
                                        itemId = null
                                    )
                                )
                            ),
                            onAcceptConsent = {},
                            onDraftMessageChange = {},
                            onApplyComposerSuggestion = {},
                            onSendMessage = {},
                            onCancelStreaming = {},
                            onNewChat = {},
                            onOpenAccountStatus = {
                                navController.navigate("account-status")
                            },
                            onDismissErrorMessage = {},
                            onDismissAlert = {},
                            onAddPendingAttachment = {},
                            onRemovePendingAttachment = {},
                            onStartDictationPermissionRequest = {},
                            onStartDictationRecording = {},
                            onTranscribeRecordedAudio = { _, _, _ -> },
                            onCancelDictation = {},
                            onScreenVisible = {},
                            onScreenHidden = {},
                            onWarmUpSessionIfNeeded = {},
                            onRetryConversationLoad = {},
                            onShowAlert = {},
                            onShowErrorMessage = {}
                        )
                    }

                    composable(route = "account-status") {
                        Text("Account status destination")
                    }
                }
            }
        }

        composeRule.onNodeWithText("Open account status").performClick()
        composeRule.onNodeWithText("Account status destination").assertIsDisplayed()
    }

    @Test
    fun blockedConversationErrorShowsAccountStatusActionInsteadOfRetry() {
        val chatUnavailableTitle = composeRule.activity.getString(AiFeatureR.string.ai_chat_unavailable_title)
        val retry = composeRule.activity.getString(AiFeatureR.string.ai_retry)
        val openAccountStatus = composeRule.activity.getString(AiFeatureR.string.ai_open_account_status)
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        conversationErrorMessage = "Cloud sync is blocked for this installation.",
                        isConversationReady = false,
                        canRetryConversationLoad = false,
                        showOpenAccountStatusForConversationError = true
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText(chatUnavailableTitle).assertIsDisplayed()
        composeRule.onNodeWithText("Cloud sync is blocked for this installation.").assertIsDisplayed()
        assertTrue(composeRule.onAllNodesWithText(retry).fetchSemanticsNodes().isEmpty())
        composeRule.onNodeWithText(openAccountStatus).assertIsDisplayed()
    }

    @Test
    fun unknownContentShowsUnsupportedPlaceholder() {
        val unsupportedType = composeRule.activity.getString(
            AiFeatureR.string.ai_unknown_type_subtitle,
            "audio_transcript_v2"
        )
        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(
                        messages = listOf(
                            AiChatMessage(
                                messageId = "assistant-unknown",
                                role = AiChatRole.ASSISTANT,
                                content = listOf(
                                    AiChatContentPart.Unknown(
                                        originalType = "audio_transcript_v2",
                                        summaryText = "Unsupported content",
                                        rawPayloadJson = """{"type":"audio_transcript_v2"}"""
                                    )
                                ),
                                timestampMillis = 1L,
                                isError = false,
                                isStopped = false,
                                cursor = null,
                                itemId = "item-1"
                            )
                        )
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
                    onApplyComposerSuggestion = {},
                    onSendMessage = {},
                    onCancelStreaming = {},
                    onNewChat = {},
                    onOpenAccountStatus = {},
                    onDismissErrorMessage = {},
                    onDismissAlert = {},
                    onAddPendingAttachment = {},
                    onRemovePendingAttachment = {},
                    onStartDictationPermissionRequest = {},
                    onStartDictationRecording = {},
                    onTranscribeRecordedAudio = { _, _, _ -> },
                    onCancelDictation = {},
                    onScreenVisible = {},
                    onScreenHidden = {},
                    onWarmUpSessionIfNeeded = {},
                    onRetryConversationLoad = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText("Unsupported content").assertIsDisplayed()
        composeRule.onNodeWithText(unsupportedType).assertIsDisplayed()
    }
}

private fun makeAiUiState(
    messages: List<AiChatMessage> = emptyList(),
    draftMessage: String = "",
    isConsentRequired: Boolean = false,
    isStreaming: Boolean = false,
    canStopStreaming: Boolean = false,
    canSend: Boolean = false,
    isComposerBusy: Boolean = false,
    isConversationReady: Boolean = true,
    conversationErrorMessage: String = "",
    canRetryConversationLoad: Boolean = true,
    showOpenAccountStatusForConversationError: Boolean = false,
    focusComposerRequestVersion: Long = 0L
): AiUiState {
    return AiUiState(
        currentWorkspaceName = "Personal",
        messages = messages,
        pendingAttachments = emptyList(),
        draftMessage = draftMessage,
        focusComposerRequestVersion = focusComposerRequestVersion,
        chatConfig = defaultAiChatServerConfig,
        isConsentRequired = isConsentRequired,
        isLinked = false,
        isConversationReady = isConversationReady,
        isConversationLoading = false,
        conversationErrorMessage = conversationErrorMessage,
        canRetryConversationLoad = canRetryConversationLoad,
        showOpenAccountStatusForConversationError = showOpenAccountStatusForConversationError,
        isComposerBusy = isComposerBusy,
        isStreaming = isStreaming,
        canStopStreaming = canStopStreaming,
        dictationState = AiChatDictationState.IDLE,
        canSend = canSend,
        canStartNewChat = messages.isNotEmpty(),
        composerSuggestions = emptyList(),
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}
