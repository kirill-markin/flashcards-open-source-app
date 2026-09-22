package com.flashcardsopensourceapp.feature.ai.input

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsDictationFailureReason
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiDictationNoSpeechException
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import com.flashcardsopensourceapp.feature.settings.access.AccessCapability
import com.flashcardsopensourceapp.feature.settings.access.AccessStatus
import com.flashcardsopensourceapp.feature.settings.access.accessCapabilityPermission
import com.flashcardsopensourceapp.feature.settings.access.hasRequestedAccessPermission
import com.flashcardsopensourceapp.feature.settings.access.markAccessPermissionRequested
import com.flashcardsopensourceapp.feature.settings.access.resolveAccessStatus

internal fun dictationStatusLabel(
    dictationState: AiChatDictationState,
    textProvider: AiTextProvider
): String {
    return when (dictationState) {
        AiChatDictationState.IDLE -> ""
        AiChatDictationState.REQUESTING_PERMISSION -> textProvider.dictationRequestingPermission
        AiChatDictationState.RECORDING -> textProvider.dictationRecording
        AiChatDictationState.TRANSCRIBING -> textProvider.dictationTranscribing
    }
}

internal fun handleCameraAction(
    activity: ComponentActivity?,
    textProvider: AiTextProvider,
    onShowAlert: (AiAlertState) -> Unit,
    onShowErrorMessage: (String) -> Unit,
    takePictureLauncher: ActivityResultLauncher<Void?>,
    cameraPermissionLauncher: ActivityResultLauncher<String>
) {
    if (activity == null) {
        onShowErrorMessage(textProvider.cameraUnavailableInHost)
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
            requestedStatus = null,
            textProvider = textProvider
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
                val permission = requireNotNull(
                    accessCapabilityPermission(capability = AccessCapability.CAMERA)
                ) {
                    textProvider.cameraPermissionUnavailable
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
    textProvider: AiTextProvider,
    onShowAlert: (AiAlertState) -> Unit,
    onPresent: () -> Unit
) {
    when (
        val result = aiCapabilityPresentationResult(
            capability = capability,
            initialStatus = AccessStatus.SYSTEM_PICKER,
            requestedStatus = null,
            textProvider = textProvider
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
    textProvider: AiTextProvider,
    dictationRecorder: AndroidAiChatDictationRecorder,
    onStartDictationPermissionRequest: () -> Unit,
    onStartDictationRecording: () -> Unit,
    onTranscribeRecordedAudio: (String, String, ByteArray) -> Unit,
    onCancelDictation: () -> Unit,
    onDictationFailed: (AnalyticsDictationFailureReason) -> Unit,
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
        } catch (_: AiDictationNoSpeechException) {
            onDictationFailed(AnalyticsDictationFailureReason.NO_SPEECH)
            dictationRecorder.cancelRecording()
            onCancelDictation()
            onShowAlert(textProvider.generalError(message = textProvider.noSpeechRecorded))
        } catch (error: Exception) {
            onDictationFailed(AnalyticsDictationFailureReason.SERVER_ERROR)
            dictationRecorder.cancelRecording()
            onCancelDictation()
            onShowAlert(
                textProvider.technicalError(
                    message = textProvider.audioRecordingFinishFailed,
                    throwable = error
                )
            )
        }
        return
    }

    if (activity == null) {
        onDictationFailed(AnalyticsDictationFailureReason.SERVER_ERROR)
        onShowErrorMessage(textProvider.microphoneUnavailableInHost)
        onCancelDictation()
        return
    }

    val hasRequestedMicrophonePermission = hasRequestedAccessPermission(
        context = activity,
        capability = AccessCapability.MICROPHONE
    )
    val status = resolveAccessStatus(
        activity = activity,
        capability = AccessCapability.MICROPHONE,
        hasRequestedPermission = hasRequestedMicrophonePermission
    )
    when (
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.MICROPHONE,
            initialStatus = status,
            requestedStatus = null,
            textProvider = textProvider
        )
    ) {
        AiCapabilityPresentationResult.Present -> {
            if (status == AccessStatus.ASK_EVERY_TIME) {
                val permission = requireNotNull(
                    accessCapabilityPermission(capability = AccessCapability.MICROPHONE)
                ) {
                    textProvider.microphonePermissionUnavailable
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
                textProvider = textProvider,
                onStartDictationRecording = onStartDictationRecording,
                onShowAlert = onShowAlert,
                onCancelDictation = onCancelDictation,
                onDictationFailed = onDictationFailed
            )
        }

        // This branch shows nothing at all, and with `requestedStatus = null` it is where an
        // `ASK_EVERY_TIME` microphone lands — which covers both a person who declined once and a
        // person this app has never asked. Only the first is a refusal, so the first tap on a
        // fresh install reports nothing rather than filing the commonest case as one.
        AiCapabilityPresentationResult.StopSilently -> {
            if (
                isDictationPermissionRefusal(
                    status = status,
                    hasRequestedPermission = hasRequestedMicrophonePermission
                )
            ) {
                onDictationFailed(AnalyticsDictationFailureReason.PERMISSION_DENIED)
            }
            onCancelDictation()
        }

        is AiCapabilityPresentationResult.ShowAlert -> {
            onDictationFailed(dictationAccessAlertFailureReason(status = status))
            onCancelDictation()
            onShowAlert(result.alert)
        }
    }
}

/**
 * Whether a microphone status that stopped the flow without a word is a refusal. `BLOCKED` always
 * is; `ASK_EVERY_TIME` only once this app has asked, because until then the OS has been shown
 * nothing to refuse.
 */
internal fun isDictationPermissionRefusal(
    status: AccessStatus,
    hasRequestedPermission: Boolean
): Boolean {
    return when (status) {
        AccessStatus.BLOCKED -> true
        AccessStatus.ASK_EVERY_TIME -> hasRequestedPermission
        AccessStatus.ALLOWED,
        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> false
    }
}

/**
 * The reason behind an alerting microphone access status. Only the statuses that produce an alert
 * reach it: `BLOCKED` is the refusal a person has to undo in Settings, and the rest mean the device
 * has no microphone to offer, which is the catalog's remaining bucket rather than an answer.
 */
internal fun dictationAccessAlertFailureReason(
    status: AccessStatus
): AnalyticsDictationFailureReason {
    return when (status) {
        AccessStatus.BLOCKED -> AnalyticsDictationFailureReason.PERMISSION_DENIED
        AccessStatus.ALLOWED,
        AccessStatus.ASK_EVERY_TIME,
        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> AnalyticsDictationFailureReason.SERVER_ERROR
    }
}

internal fun startDictationRecording(
    dictationRecorder: AndroidAiChatDictationRecorder,
    textProvider: AiTextProvider,
    onStartDictationRecording: () -> Unit,
    onShowAlert: (AiAlertState) -> Unit,
    onCancelDictation: () -> Unit,
    onDictationFailed: (AnalyticsDictationFailureReason) -> Unit
) {
    try {
        dictationRecorder.startRecording()
        onStartDictationRecording()
    } catch (error: Exception) {
        onDictationFailed(AnalyticsDictationFailureReason.SERVER_ERROR)
        dictationRecorder.cancelRecording()
        onCancelDictation()
        onShowAlert(
            textProvider.technicalError(
                message = textProvider.audioRecordingStartFailed,
                throwable = error
            )
        )
    }
}
