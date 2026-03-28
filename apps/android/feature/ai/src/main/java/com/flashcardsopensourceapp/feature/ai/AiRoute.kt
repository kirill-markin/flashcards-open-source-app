package com.flashcardsopensourceapp.feature.ai

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiRoute(
    uiState: AiUiState,
    onAcceptConsent: () -> Unit,
    onDraftMessageChange: (String) -> Unit,
    onSendMessage: () -> Unit,
    onCancelStreaming: () -> Unit,
    onNewChat: () -> Unit,
    onOpenAccountStatus: () -> Unit,
    onDismissErrorMessage: () -> Unit,
    onDismissAlert: () -> Unit,
    onAddPendingAttachment: (AiChatAttachment) -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onWarmUpSessionIfNeeded: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit
) {
    AiRouteContent(
        uiState = uiState,
        onAcceptConsent = onAcceptConsent,
        onDraftMessageChange = onDraftMessageChange,
        onSendMessage = onSendMessage,
        onCancelStreaming = onCancelStreaming,
        onNewChat = onNewChat,
        onOpenAccountStatus = onOpenAccountStatus,
        onDismissErrorMessage = onDismissErrorMessage,
        onDismissAlert = onDismissAlert,
        onAddPendingAttachment = onAddPendingAttachment,
        onRemovePendingAttachment = onRemovePendingAttachment,
        onStartDictationPermissionRequest = onStartDictationPermissionRequest,
        onStartDictationRecording = onStartDictationRecording,
        onTranscribeRecordedAudio = onTranscribeRecordedAudio,
        onCancelDictation = onCancelDictation,
        onWarmUpSessionIfNeeded = onWarmUpSessionIfNeeded,
        onShowAlert = onShowAlert,
        onShowErrorMessage = onShowErrorMessage
    )
}
