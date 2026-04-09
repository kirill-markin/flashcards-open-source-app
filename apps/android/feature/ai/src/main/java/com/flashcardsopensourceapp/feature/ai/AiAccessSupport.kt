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
    requestedStatus: AccessStatus?,
    textProvider: AiTextProvider
): AiCapabilityPresentationResult {
    return when (capability) {
        AccessCapability.CAMERA -> aiCameraPresentationResult(
            initialStatus = initialStatus,
            requestedStatus = requestedStatus,
            textProvider = textProvider
        )

        AccessCapability.MICROPHONE -> aiMicrophonePresentationResult(
            initialStatus = initialStatus,
            requestedStatus = requestedStatus,
            textProvider = textProvider
        )

        AccessCapability.PHOTOS -> aiAttachmentPickerPresentationResult(
            capability = capability,
            status = initialStatus,
            textProvider = textProvider
        )

        AccessCapability.FILES -> aiAttachmentPickerPresentationResult(
            capability = capability,
            status = initialStatus,
            textProvider = textProvider
        )
    }
}

fun aiAttachmentImportAlert(
    capability: AccessCapability,
    error: Exception,
    textProvider: AiTextProvider
): AiAlertState {
    return if (error is SecurityException) {
        when (capability) {
            AccessCapability.CAMERA -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.CAMERA)
            AccessCapability.PHOTOS -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.PHOTOS)
            AccessCapability.FILES -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.FILES)
            AccessCapability.MICROPHONE -> textProvider.microphoneSettingsAlert()
        }
    } else {
        textProvider.generalError(message = error.message ?: textProvider.selectedAttachmentCouldNotBeAdded)
    }
}

private fun aiCameraPresentationResult(
    initialStatus: AccessStatus,
    requestedStatus: AccessStatus?,
    textProvider: AiTextProvider
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
                alert = textProvider.generalError(message = textProvider.cameraUnavailableOnDevice)
            )
        }

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.CAMERA)
        )

        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = textProvider.generalError(message = textProvider.cameraUnavailableOnDevice)
        )
    }
}

private fun aiMicrophonePresentationResult(
    initialStatus: AccessStatus,
    requestedStatus: AccessStatus?,
    textProvider: AiTextProvider
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
                alert = textProvider.generalError(message = textProvider.microphoneUnavailableOnDevice)
            )
        }

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = textProvider.microphoneSettingsAlert()
        )

        AccessStatus.SYSTEM_PICKER,
        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = textProvider.generalError(message = textProvider.microphoneUnavailableOnDevice)
        )
    }
}

private fun aiAttachmentPickerPresentationResult(
    capability: AccessCapability,
    status: AccessStatus,
    textProvider: AiTextProvider
): AiCapabilityPresentationResult {
    return when (status) {
        AccessStatus.ALLOWED,
        AccessStatus.ASK_EVERY_TIME,
        AccessStatus.SYSTEM_PICKER -> AiCapabilityPresentationResult.Present

        AccessStatus.BLOCKED -> AiCapabilityPresentationResult.ShowAlert(
            alert = when (capability) {
                AccessCapability.PHOTOS -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.PHOTOS)
                AccessCapability.FILES -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.FILES)
                AccessCapability.CAMERA -> textProvider.attachmentSettingsAlert(source = AiAttachmentSettingsSource.CAMERA)
                AccessCapability.MICROPHONE -> textProvider.microphoneSettingsAlert()
            }
        )

        AccessStatus.UNAVAILABLE -> AiCapabilityPresentationResult.ShowAlert(
            alert = textProvider.generalError(message = textProvider.deviceUnavailableMessage(capability = capability))
        )
    }
}
