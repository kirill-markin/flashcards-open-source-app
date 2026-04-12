package com.flashcardsopensourceapp.feature.ai.strings

import android.content.Context
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.feature.ai.R
import com.flashcardsopensourceapp.feature.ai.runtime.AiAlertState
import com.flashcardsopensourceapp.feature.ai.runtime.AiAttachmentSettingsSource
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import java.util.Locale

data class AiTextProvider(
    val loadingLabel: String,
    val unavailableLabel: String,
    val requestFailed: String,
    val noSpeechRecorded: String,
    val cardHandoffRequiresNewChat: String,
    val responseInProgress: String,
    val chatFailed: String,
    val liveStreamEndedBeforeCompletion: String,
    val errorTitle: String,
    val dictationRequestingPermission: String,
    val dictationRecording: String,
    val dictationTranscribing: String,
    val cameraUnavailableInHost: String,
    val cameraPermissionUnavailable: String,
    val audioRecordingFinishFailed: String,
    val microphoneUnavailableInHost: String,
    val microphonePermissionUnavailable: String,
    val audioRecordingStartFailed: String,
    val selectedAttachmentCouldNotBeAdded: String,
    val cameraUnavailableOnDevice: String,
    val microphoneUnavailableOnDevice: String,
    val photoAccessUnavailableOnDevice: String,
    val fileAccessUnavailableOnDevice: String,
    val dictationRecordingNotActive: String,
    val dictationRecordingFileMissing: String,
    val capturedPhotoEncodeFailed: String,
    val selectedImageReadFailed: String,
    val selectedItemNotImage: String,
    val selectedFileReadFailed: String,
    val selectedFileNameUnavailable: String,
    val selectedFileTypeUnsupported: String,
    val selectedFileTypeUnsupportedWithExtensionFormat: String,
    val attachmentTooLarge: String,
    val serverChatOfficialUnavailable: String,
    val serverChatCustomUnavailable: String,
    val serverDictationOfficialUnavailable: String,
    val serverDictationCustomUnavailable: String,
    val entryPrefillCreateCard: String,
    val microphoneSettingsTitle: String,
    val microphoneSettingsMessage: String,
    val cameraSettingsTitle: String,
    val cameraSettingsMessage: String,
    val photosSettingsTitle: String,
    val photosSettingsMessage: String,
    val filesSettingsTitle: String,
    val filesSettingsMessage: String,
    val toolSql: String,
    val toolCodeExecution: String,
    val toolWebSearch: String,
    val toolRunning: String,
    val toolDone: String,
    val consentRequiredMessage: String,
    val guestQuotaReachedMessage: String,
    val guestQuotaButtonTitle: String,
    private val fastLabel: String,
    private val mediumLabel: String,
    private val longLabel: String,
    private val messageWithRequestIdFormat: String,
    private val bidiLocale: Locale
) {
    fun generalError(message: String): AiAlertState {
        return AiAlertState.GeneralError(
            title = errorTitle,
            message = message
        )
    }

    fun microphoneSettingsAlert(): AiAlertState {
        return AiAlertState.SettingsActionRequired(
            title = microphoneSettingsTitle,
            message = microphoneSettingsMessage
        )
    }

    fun attachmentSettingsAlert(source: AiAttachmentSettingsSource): AiAlertState {
        return when (source) {
            AiAttachmentSettingsSource.CAMERA -> AiAlertState.SettingsActionRequired(
                title = cameraSettingsTitle,
                message = cameraSettingsMessage
            )

            AiAttachmentSettingsSource.PHOTOS -> AiAlertState.SettingsActionRequired(
                title = photosSettingsTitle,
                message = photosSettingsMessage
            )

            AiAttachmentSettingsSource.FILES -> AiAlertState.SettingsActionRequired(
                title = filesSettingsTitle,
                message = filesSettingsMessage
            )
        }
    }

    fun deviceUnavailableMessage(capability: AccessCapability): String {
        return when (capability) {
            AccessCapability.CAMERA -> cameraUnavailableOnDevice
            AccessCapability.MICROPHONE -> microphoneUnavailableOnDevice
            AccessCapability.PHOTOS -> photoAccessUnavailableOnDevice
            AccessCapability.FILES -> fileAccessUnavailableOnDevice
        }
    }

    fun toolLabel(name: String): String {
        return when (name) {
            "sql" -> toolSql
            "code_execution", "code_interpreter" -> toolCodeExecution
            "web_search" -> toolWebSearch
            else -> name
        }
    }

    fun toolStatus(status: AiChatToolCallStatus): String {
        return when (status) {
            AiChatToolCallStatus.STARTED -> toolRunning
            AiChatToolCallStatus.COMPLETED -> toolDone
        }
    }

    fun messageWithRequestId(message: String, requestId: String): String {
        return messageWithRequestIdFormat.format(
            bidiWrap(
                text = message,
                locale = bidiLocale
            ),
            bidiWrap(
                text = requestId,
                locale = bidiLocale
            )
        )
    }

    fun unsupportedFileType(extension: String): String {
        val normalizedExtension = extension.trim().lowercase()
        if (normalizedExtension.isEmpty()) {
            return selectedFileTypeUnsupported
        }

        return selectedFileTypeUnsupportedWithExtensionFormat.format(
            bidiWrap(
                text = normalizedExtension,
                locale = bidiLocale
            )
        )
    }

    fun effortLabel(effortLevel: EffortLevel): String {
        return when (effortLevel) {
            EffortLevel.FAST -> fastLabel
            EffortLevel.MEDIUM -> mediumLabel
            EffortLevel.LONG -> longLabel
        }
    }
}

fun aiTextProvider(context: Context): AiTextProvider {
    return AiTextProvider(
        loadingLabel = context.getString(R.string.ai_loading),
        unavailableLabel = context.getString(R.string.ai_unavailable),
        requestFailed = context.getString(R.string.ai_request_failed),
        noSpeechRecorded = context.getString(R.string.ai_no_speech_recorded),
        cardHandoffRequiresNewChat = context.getString(R.string.ai_card_handoff_requires_new_chat),
        responseInProgress = context.getString(R.string.ai_response_in_progress),
        chatFailed = context.getString(R.string.ai_chat_failed),
        liveStreamEndedBeforeCompletion = context.getString(R.string.ai_live_stream_ended_before_completion),
        errorTitle = context.getString(R.string.ai_alert_error_title),
        dictationRequestingPermission = context.getString(R.string.ai_dictation_requesting_permission),
        dictationRecording = context.getString(R.string.ai_dictation_recording),
        dictationTranscribing = context.getString(R.string.ai_dictation_transcribing),
        cameraUnavailableInHost = context.getString(R.string.ai_camera_unavailable_in_host),
        cameraPermissionUnavailable = context.getString(R.string.ai_camera_permission_unavailable),
        audioRecordingFinishFailed = context.getString(R.string.ai_audio_recording_finish_failed),
        microphoneUnavailableInHost = context.getString(R.string.ai_microphone_unavailable_in_host),
        microphonePermissionUnavailable = context.getString(R.string.ai_microphone_permission_unavailable),
        audioRecordingStartFailed = context.getString(R.string.ai_audio_recording_start_failed),
        selectedAttachmentCouldNotBeAdded = context.getString(R.string.ai_selected_attachment_could_not_be_added),
        cameraUnavailableOnDevice = context.getString(R.string.ai_camera_unavailable_on_device),
        microphoneUnavailableOnDevice = context.getString(R.string.ai_microphone_unavailable_on_device),
        photoAccessUnavailableOnDevice = context.getString(R.string.ai_photo_access_unavailable_on_device),
        fileAccessUnavailableOnDevice = context.getString(R.string.ai_file_access_unavailable_on_device),
        dictationRecordingNotActive = context.getString(R.string.ai_dictation_recording_not_active),
        dictationRecordingFileMissing = context.getString(R.string.ai_dictation_recording_file_missing),
        capturedPhotoEncodeFailed = context.getString(R.string.ai_captured_photo_encode_failed),
        selectedImageReadFailed = context.getString(R.string.ai_selected_image_read_failed),
        selectedItemNotImage = context.getString(R.string.ai_selected_item_not_image),
        selectedFileReadFailed = context.getString(R.string.ai_selected_file_read_failed),
        selectedFileNameUnavailable = context.getString(R.string.ai_selected_file_name_unavailable),
        selectedFileTypeUnsupported = context.getString(R.string.ai_selected_file_type_unsupported),
        selectedFileTypeUnsupportedWithExtensionFormat = context.getString(R.string.ai_selected_file_type_unsupported_with_extension),
        attachmentTooLarge = context.getString(R.string.ai_attachment_too_large),
        serverChatOfficialUnavailable = context.getString(R.string.ai_server_chat_official_unavailable),
        serverChatCustomUnavailable = context.getString(R.string.ai_server_chat_custom_unavailable),
        serverDictationOfficialUnavailable = context.getString(R.string.ai_server_dictation_official_unavailable),
        serverDictationCustomUnavailable = context.getString(R.string.ai_server_dictation_custom_unavailable),
        entryPrefillCreateCard = context.getString(R.string.ai_entry_prefill_create_card),
        microphoneSettingsTitle = context.getString(R.string.ai_alert_microphone_title),
        microphoneSettingsMessage = context.getString(R.string.ai_alert_microphone_message),
        cameraSettingsTitle = context.getString(R.string.ai_alert_camera_title),
        cameraSettingsMessage = context.getString(R.string.ai_alert_camera_message),
        photosSettingsTitle = context.getString(R.string.ai_alert_photos_title),
        photosSettingsMessage = context.getString(R.string.ai_alert_photos_message),
        filesSettingsTitle = context.getString(R.string.ai_alert_files_title),
        filesSettingsMessage = context.getString(R.string.ai_alert_files_message),
        toolSql = context.getString(R.string.ai_tool_sql),
        toolCodeExecution = context.getString(R.string.ai_tool_code_execution),
        toolWebSearch = context.getString(R.string.ai_tool_web_search),
        toolRunning = context.getString(R.string.ai_tool_running),
        toolDone = context.getString(R.string.ai_tool_done),
        consentRequiredMessage = context.getString(R.string.ai_consent_required_message),
        guestQuotaReachedMessage = context.getString(R.string.ai_guest_quota_reached_message),
        guestQuotaButtonTitle = context.getString(R.string.ai_guest_quota_button_title),
        fastLabel = context.getString(R.string.ai_fast),
        mediumLabel = context.getString(R.string.ai_medium),
        longLabel = context.getString(R.string.ai_long),
        messageWithRequestIdFormat = context.getString(R.string.ai_message_with_request_id),
        bidiLocale = currentResourceLocale(resources = context.resources)
    )
}

fun testAiTextProvider(): AiTextProvider {
    return AiTextProvider(
        loadingLabel = "Loading...",
        unavailableLabel = "Unavailable",
        requestFailed = "AI request failed.",
        noSpeechRecorded = "No speech was recorded.",
        cardHandoffRequiresNewChat = "Start a new chat before handing off a card to AI.",
        responseInProgress = "A response is already in progress. Wait for it to finish or stop it before sending another message.",
        chatFailed = "AI chat failed.",
        liveStreamEndedBeforeCompletion = "AI live stream ended before message completion.",
        errorTitle = "Error",
        dictationRequestingPermission = "Requesting microphone access...",
        dictationRecording = "Recording audio...",
        dictationTranscribing = "Transcribing audio...",
        cameraUnavailableInHost = "Camera is unavailable in this Android host.",
        cameraPermissionUnavailable = "Camera permission is unavailable.",
        audioRecordingFinishFailed = "Audio recording could not be finished.",
        microphoneUnavailableInHost = "Microphone is unavailable in this Android host.",
        microphonePermissionUnavailable = "Microphone permission is unavailable.",
        audioRecordingStartFailed = "Audio recording could not be started.",
        selectedAttachmentCouldNotBeAdded = "The selected attachment could not be added.",
        cameraUnavailableOnDevice = "Camera is not available on this device.",
        microphoneUnavailableOnDevice = "Microphone is not available on this device.",
        photoAccessUnavailableOnDevice = "Photo access is not available on this device.",
        fileAccessUnavailableOnDevice = "File access is not available on this device.",
        dictationRecordingNotActive = "Dictation recording is not active.",
        dictationRecordingFileMissing = "Dictation recording file is missing.",
        capturedPhotoEncodeFailed = "Captured photo could not be encoded.",
        selectedImageReadFailed = "Selected image could not be read.",
        selectedItemNotImage = "Selected item is not an image.",
        selectedFileReadFailed = "Selected file could not be read.",
        selectedFileNameUnavailable = "Selected file name is unavailable.",
        selectedFileTypeUnsupported = "Selected file type is unsupported.",
        selectedFileTypeUnsupportedWithExtensionFormat = "Unsupported file type: .%1\$s",
        attachmentTooLarge = "File is too large. Maximum allowed size is 20 MB.",
        serverChatOfficialUnavailable = "AI is temporarily unavailable on the official server. Try again later.",
        serverChatCustomUnavailable = "AI is unavailable on this server. Contact the server operator.",
        serverDictationOfficialUnavailable = "AI dictation is temporarily unavailable on the official server. Try again later.",
        serverDictationCustomUnavailable = "AI dictation is unavailable on this server. Contact the server operator.",
        entryPrefillCreateCard = "Help me create a card.",
        microphoneSettingsTitle = "Microphone access needed",
        microphoneSettingsMessage = "Microphone access is turned off for Flashcards Open Source App. Open Settings to allow it.",
        cameraSettingsTitle = "Camera access needed",
        cameraSettingsMessage = "Camera access is turned off for Flashcards Open Source App. Open Settings to allow it.",
        photosSettingsTitle = "Photo access needed",
        photosSettingsMessage = "Photo access is turned off for Flashcards Open Source App. Open Settings to allow it.",
        filesSettingsTitle = "File access needed",
        filesSettingsMessage = "File access is turned off for Flashcards Open Source App. Open Settings to allow it.",
        toolSql = "SQL",
        toolCodeExecution = "Code execution",
        toolWebSearch = "Web search",
        toolRunning = "Running",
        toolDone = "Done",
        consentRequiredMessage = "Review AI data use and accept it on this device before using AI features.",
        guestQuotaReachedMessage = "Your free guest AI limit for this month is used up. Create an account or log in to keep using AI.",
        guestQuotaButtonTitle = "Create account or Log in",
        fastLabel = "Fast",
        mediumLabel = "Medium",
        longLabel = "Long",
        messageWithRequestIdFormat = "%1\$s Request ID: %2\$s",
        bidiLocale = Locale.ENGLISH
    )
}
