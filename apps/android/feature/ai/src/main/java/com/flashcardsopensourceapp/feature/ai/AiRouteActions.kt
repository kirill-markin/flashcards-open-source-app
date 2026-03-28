package com.flashcardsopensourceapp.feature.ai

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus
import com.flashcardsopensourceapp.feature.settings.accessCapabilityPermission
import com.flashcardsopensourceapp.feature.settings.hasRequestedAccessPermission
import com.flashcardsopensourceapp.feature.settings.markAccessPermissionRequested
import com.flashcardsopensourceapp.feature.settings.resolveAccessStatus

internal fun dictationStatusLabel(dictationState: AiChatDictationState): String {
    return when (dictationState) {
        AiChatDictationState.IDLE -> ""
        AiChatDictationState.REQUESTING_PERMISSION -> "Requesting microphone access..."
        AiChatDictationState.RECORDING -> "Recording audio..."
        AiChatDictationState.TRANSCRIBING -> "Transcribing audio..."
    }
}

internal fun handleCameraAction(
    activity: ComponentActivity?,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit,
    takePictureLauncher: ActivityResultLauncher<Void?>,
    cameraPermissionLauncher: ActivityResultLauncher<String>
) {
    if (activity == null) {
        onShowErrorMessage("Camera is unavailable in this Android host.")
        return
    }

    val status = resolveAccessStatus(
        activity = activity,
        capability = AccessCapability.CAMERA,
        hasRequestedPermission = hasRequestedAccessPermission(
            context = activity,
            capability = AccessCapability.CAMERA
        )
    )
    when (
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.CAMERA,
            initialStatus = status,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
                val permission = requireNotNull(
                    accessCapabilityPermission(capability = AccessCapability.CAMERA)
                ) {
                    "Camera permission is unavailable."
                }
                markAccessPermissionRequested(
                    context = activity,
                    capability = AccessCapability.CAMERA
                )
                cameraPermissionLauncher.launch(permission)
                return
            }

            takePictureLauncher.launch(null)
        }

        AiCapabilityPresentationResult.StopSilently -> Unit

        is AiCapabilityPresentationResult.ShowAlert -> {
            onShowAlert(result.alert)
        }
    }
}

internal fun handleAttachmentAction(
    capability: AccessCapability,
    onShowAlert: (AiAlertState) -> Unit,
    onPresent: () -> Unit
) {
    when (
        val result = aiCapabilityPresentationResult(
            capability = capability,
            initialStatus = AccessStatus.SYSTEM_PICKER,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> onPresent()
        AiCapabilityPresentationResult.StopSilently -> Unit
        is AiCapabilityPresentationResult.ShowAlert -> onShowAlert(result.alert)
    }
}

internal fun handleDictationToggle(
    activity: ComponentActivity?,
    dictationState: AiChatDictationState,
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit,
    microphonePermissionLauncher: ActivityResultLauncher<String>
) {
    if (dictationState == AiChatDictationState.RECORDING) {
        try {
            val recordedAudio = dictationRecorder.stopRecording()
            onTranscribeRecordedAudio(
                recordedAudio.fileName,
                recordedAudio.mediaType,
                recordedAudio.audioBytes
            )
        } catch (error: Exception) {
            dictationRecorder.cancelRecording()
            onCancelDictation()
            onShowAlert(AiAlertState.GeneralError(message = error.message ?: "Audio recording could not be finished."))
        }
        return
    }

    if (activity == null) {
        onShowErrorMessage("Microphone is unavailable in this Android host.")
        onCancelDictation()
        return
    }

    val status = resolveAccessStatus(
        activity = activity,
        capability = AccessCapability.MICROPHONE,
        hasRequestedPermission = hasRequestedAccessPermission(
            context = activity,
            capability = AccessCapability.MICROPHONE
        )
    )
    when (
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.MICROPHONE,
            initialStatus = status,
            requestedStatus = null
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
                val permission = requireNotNull(
                    accessCapabilityPermission(capability = AccessCapability.MICROPHONE)
                ) {
                    "Microphone permission is unavailable."
                }
                onStartDictationPermissionRequest()
                markAccessPermissionRequested(
                    context = activity,
                    capability = AccessCapability.MICROPHONE
                )
                microphonePermissionLauncher.launch(permission)
                return
            }

            startDictationRecording(
                dictationRecorder = dictationRecorder,
                onStartDictationRecording = onStartDictationRecording,
                onShowAlert = onShowAlert,
                onCancelDictation = onCancelDictation
            )
        }

        AiCapabilityPresentationResult.StopSilently -> {
            onCancelDictation()
        }

        is AiCapabilityPresentationResult.ShowAlert -> {
            onCancelDictation()
            onShowAlert(result.alert)
        }
    }
}

internal fun startDictationRecording(
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationRecording: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onCancelDictation: () -> Unit
) {
    try {
        dictationRecorder.startRecording()
        onStartDictationRecording()
    } catch (error: Exception) {
        dictationRecorder.cancelRecording()
        onCancelDictation()
        onShowAlert(AiAlertState.GeneralError(message = error.message ?: "Audio recording could not be started."))
    }
}
