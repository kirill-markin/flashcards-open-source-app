package com.flashcardsopensourceapp.app

import android.content.ClipboardManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
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
import com.flashcardsopensourceapp.feature.ai.formatAiConsentWorkspaceDisclosureText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AiRouteTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun consentGateShowsLegalLinksAndAcceptsConsent() {
        var consentRequired by mutableStateOf(value = true)

        composeRule.setContent {
            FlashcardsTheme {
                AiRoute(
                    uiState = makeAiUiState(isConsentRequired = consentRequired),
                    onAcceptConsent = {
                        consentRequired = false
                    },
                    onDraftMessageChange = {},
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
                    onWarmUpSessionIfNeeded = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText("Before you use AI").assertIsDisplayed()
        composeRule.onNodeWithText(
            formatAiConsentWorkspaceDisclosureText(currentWorkspaceName = "Personal")
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Privacy Policy").assertIsDisplayed()
        composeRule.onNodeWithText("Terms of Service").assertIsDisplayed()
        composeRule.onNodeWithText("Support").assertIsDisplayed()
        composeRule.onNodeWithText("OK").performClick()
        composeRule.onNodeWithText("Message").assertIsDisplayed()
    }

    @Test
    fun toolCallDetailsExpandAndCopyOutput() {
        val toolOutput = "{\"rows\":[1]}"

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
                                isError = false
                            )
                        )
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
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
                    onWarmUpSessionIfNeeded = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithContentDescription("Expand tool details").performClick()
        composeRule.onNodeWithText("{\"sql\":\"SELECT 1\"}").assertIsDisplayed()
        composeRule.onNodeWithText(toolOutput).assertIsDisplayed()
        composeRule.onNode(
            matcher = hasText("Copy output").and(other = hasClickAction())
        ).performClick()

        val clipboardManager = composeRule.activity.getSystemService(ClipboardManager::class.java)
        assertTrue(clipboardManager != null)
    }

    @Test
    fun streamingComposerPrimaryActionShowsStop() {
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
                                isError = false
                            )
                        ),
                        isStreaming = true,
                        canStopStreaming = true
                    ),
                    onAcceptConsent = {},
                    onDraftMessageChange = {},
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
                    onWarmUpSessionIfNeeded = {},
                    onShowAlert = {},
                    onShowErrorMessage = {}
                )
            }
        }

        composeRule.onNodeWithText("Stop").assertIsDisplayed()
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
                                        isError = false
                                    )
                                )
                            ),
                            onAcceptConsent = {},
                            onDraftMessageChange = {},
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
                            onWarmUpSessionIfNeeded = {},
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
}

private fun makeAiUiState(
    messages: List<AiChatMessage> = emptyList(),
    isConsentRequired: Boolean = false,
    isStreaming: Boolean = false,
    canStopStreaming: Boolean = false
): AiUiState {
    return AiUiState(
        currentWorkspaceName = "Personal",
        messages = messages,
        pendingAttachments = emptyList(),
        draftMessage = "",
        chatConfig = defaultAiChatServerConfig,
        isConsentRequired = isConsentRequired,
        isLinked = false,
        isStreaming = isStreaming,
        canStopStreaming = canStopStreaming,
        dictationState = AiChatDictationState.IDLE,
        canSend = false,
        canStartNewChat = messages.isNotEmpty(),
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}
