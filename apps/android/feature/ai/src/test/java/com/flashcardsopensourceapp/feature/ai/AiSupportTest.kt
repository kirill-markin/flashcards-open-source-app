package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiSupportTest {
    @Test
    fun chatAvailabilityMessageUsesOfficialCopy() {
        val message = aiChatAvailabilityMessage(
            code = "LOCAL_CHAT_UNAVAILABLE",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            surface = AiErrorSurface.CHAT
        )

        assertEquals(
            "AI is temporarily unavailable on the official server. Try again later.",
            message
        )
    }

    @Test
    fun dictationAvailabilityMessageUsesCustomCopy() {
        val message = aiChatAvailabilityMessage(
            code = "CHAT_TRANSCRIPTION_UNAVAILABLE",
            configurationMode = CloudServiceConfigurationMode.CUSTOM,
            surface = AiErrorSurface.DICTATION
        )

        assertEquals(
            "AI dictation is unavailable on this server. Contact the server operator.",
            message
        )
    }

    @Test
    fun userFacingErrorMessageAppendsRequestId() {
        val message = makeAiChatUserFacingErrorMessage(
            rawMessage = "Fallback error",
            code = "LOCAL_CHAT_UNAVAILABLE",
            requestId = "request-42",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL,
            surface = AiErrorSurface.CHAT
        )

        assertEquals(
            "AI is temporarily unavailable on the official server. Try again later. Request ID: request-42",
            message
        )
    }

    @Test
    fun blockedCameraShowsSettingsAlert() {
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.CAMERA,
            initialStatus = AccessStatus.BLOCKED,
            requestedStatus = null
        )

        val alert = (result as AiCapabilityPresentationResult.ShowAlert).alert
        assertEquals(
            AiAlertState.AttachmentSettings(source = AiAttachmentSettingsSource.CAMERA),
            alert
        )
    }

    @Test
    fun deniedMicrophoneRequestStopsSilently() {
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.MICROPHONE,
            initialStatus = AccessStatus.ASK_EVERY_TIME,
            requestedStatus = AccessStatus.BLOCKED
        )

        assertEquals(AiCapabilityPresentationResult.StopSilently, result)
    }

    @Test
    fun photosUseSystemPickerPresentation() {
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.PHOTOS,
            initialStatus = AccessStatus.SYSTEM_PICKER,
            requestedStatus = null
        )

        assertEquals(AiCapabilityPresentationResult.Present, result)
    }

    @Test
    fun unavailableFilesShowGeneralError() {
        val result = aiCapabilityPresentationResult(
            capability = AccessCapability.FILES,
            initialStatus = AccessStatus.UNAVAILABLE,
            requestedStatus = null
        )

        val alert = (result as AiCapabilityPresentationResult.ShowAlert).alert
        assertTrue(alert is AiAlertState.GeneralError)
        assertEquals("File access is not available on this device.", alert.message)
    }
}
