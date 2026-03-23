package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus

sealed interface AiCapabilityPresentationResult {
    data object Present : AiCapabilityPresentationResult

    data object StopSilently : AiCapabilityPresentationResult

    data class ShowAlert(
        val alert: AiAlertState
    ) : AiCapabilityPresentationResult
}

fun aiCapabilityPresentationResult(
    capability: AccessCapability,
    initialStatus: AccessStatus,
    requestedStatus: AccessStatus?
): AiCapabilityPresentationResult {
    return when (capability) {
        AccessCapability.CAMERA -> aiCameraPresentationResult(
            initialStatus = initialStatus,
            requestedStatus = requestedStatus
        )

        AccessCapability.MICROPHONE -> aiMicrophonePresentationResult(
            initialStatus = initialStatus,
            requestedStatus = requestedStatus
        )

        AccessCapability.PHOTOS -> aiAttachmentPickerPresentationResult(
            capability = capability,
            status = initialStatus
        )

        AccessCapability.FILES -> aiAttachmentPickerPresentationResult(
            capability = capability,
            status = initialStatus
        )
    }
}

fun aiAttachmentImportAlert(
    capability: AccessCapability,
    error: Exception
): AiAlertState {
    return if (error is SecurityException) {
        when (capability) {
            AccessCapability.CAMERA -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.CAMERA)
            AccessCapability.PHOTOS -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.PHOTOS)
            AccessCapability.FILES -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.FILES)
            AccessCapability.MICROPHONE -> AiAlertState.MicrophoneSettings
        }
    } else {
        AiAlertState.GeneralError(
            message = error.message ?: "The selected attachment could not be added."
        )
    }
}

private fun aiCameraPresentationResult(
    initialStatus: AccessStatus,
    requestedStatus: AccessStatus?
): AiCapabilityPresentationResult {
    return when (initialStatus) {
        AccessStatus.ALLOWED -> AiCapabilityPresentationResult.Present
        AccessStatus.ASK_EVERY_TIME -> when (requestedStatus) {
            null -> AiCapabilityPresentationResult.StopSilently
            AccessStatus.ALLOWED -> AiCapabilityPresentationResult.Present
            AccessStatus.ASK_EVERY_TIME,
            AccessStatus.BLOCKED -> AiCapabilityPresentationResult.StopSilently
            AccessStatus.SYSTEM_PICKER,
            AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
                alert = AiAlertState.GeneralError(message = "Camera is not available on this device.")
            )
        }

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.CAMERA)
        )

        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = AiAlertState.GeneralError(message = "Camera is not available on this device.")
        )
    }
}

private fun aiMicrophonePresentationResult(
    initialStatus: AccessStatus,
    requestedStatus: AccessStatus?
): AiCapabilityPresentationResult {
    return when (initialStatus) {
        AccessStatus.ALLOWED -> AiCapabilityPresentationResult.Present
        AccessStatus.ASK_EVERY_TIME -> when (requestedStatus) {
            null -> AiCapabilityPresentationResult.StopSilently
            AccessStatus.ALLOWED -> AiCapabilityPresentationResult.Present
            AccessStatus.ASK_EVERY_TIME,
            AccessStatus.BLOCKED -> AiCapabilityPresentationResult.StopSilently
            AccessStatus.SYSTEM_PICKER,
            AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
                alert = AiAlertState.GeneralError(message = "Microphone is not available on this device.")
            )
        }

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = AiAlertState.MicrophoneSettings
        )

        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = AiAlertState.GeneralError(message = "Microphone is not available on this device.")
        )
    }
}

private fun aiAttachmentPickerPresentationResult(
    capability: AccessCapability,
    status: AccessStatus
): AiCapabilityPresentationResult {
    return when (status) {
        AccessStatus.ALLOWED,
        AccessStatus.ASK_EVERY_TIME,
        AccessStatus.SYSTEM_PICKER -> AiCapabilityPresentationResult.Present

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = when (capability) {
                AccessCapability.PHOTOS -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.PHOTOS)
                AccessCapability.FILES -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.FILES)
                AccessCapability.CAMERA -> AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.CAMERA)
                AccessCapability.MICROPHONE -> AiAlertState.MicrophoneSettings
            }
        )

        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = AiAlertState.GeneralError(
                message = when (capability) {
                    AccessCapability.PHOTOS -> "Photo access is not available on this device."
                    AccessCapability.FILES -> "File access is not available on this device."
                    AccessCapability.CAMERA -> "Camera is not available on this device."
                    AccessCapability.MICROPHONE -> "Microphone is not available on this device."
                }
            )
        )
    }
}
