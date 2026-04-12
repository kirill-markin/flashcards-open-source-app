package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

enum class AiErrorSurface {
    CHAT,
    DICTATION
}

private val aiChatAvailabilityErrorCodes: Set<String> = setOf(
    "LOCAL_CHAT_NOT_CONFIGURED",
    "LOCAL_CHAT_UNAVAILABLE",
    "LOCAL_CHAT_CONTINUATION_FAILED",
    "LOCAL_CHAT_RATE_LIMITED",
    "LOCAL_CHAT_PROVIDER_AUTH_FAILED"
)

private val aiChatDictationAvailabilityErrorCodes: Set<String> = setOf(
    "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
    "CHAT_TRANSCRIPTION_UNAVAILABLE",
    "CHAT_TRANSCRIPTION_RATE_LIMITED",
    "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED"
)

fun aiChatAvailabilityMessage(
    code: String,
    configurationMode: CloudServiceConfigurationMode,
    surface: AiErrorSurface,
    textProvider: AiTextProvider
): String? {
    return when (surface) {
        AiErrorSurface.CHAT -> {
            if (aiChatAvailabilityErrorCodes.contains(code).not()) {
                return null
            }

            when (configurationMode) {
                CloudServiceConfigurationMode.OFFICIAL ->
                    textProvider.serverChatOfficialUnavailable

                CloudServiceConfigurationMode.CUSTOM ->
                    textProvider.serverChatCustomUnavailable
            }
        }

        AiErrorSurface.DICTATION -> {
            if (aiChatDictationAvailabilityErrorCodes.contains(code).not()) {
                return null
            }

            when (configurationMode) {
                CloudServiceConfigurationMode.OFFICIAL ->
                    textProvider.serverDictationOfficialUnavailable

                CloudServiceConfigurationMode.CUSTOM ->
                    textProvider.serverDictationCustomUnavailable
            }
        }
    }
}

fun makeAiChatUserFacingErrorMessage(
    rawMessage: String,
    code: String?,
    requestId: String?,
    configurationMode: CloudServiceConfigurationMode,
    surface: AiErrorSurface,
    textProvider: AiTextProvider
): String {
    val mappedMessage = if (code == null) {
        null
    } else {
        aiChatAvailabilityMessage(
            code = code,
            configurationMode = configurationMode,
            surface = surface,
            textProvider = textProvider
        )
    }

    return appendAiRequestIdReference(
        message = mappedMessage ?: rawMessage,
        requestId = requestId,
        textProvider = textProvider
    )
}

private fun appendAiRequestIdReference(
    message: String,
    requestId: String?,
    textProvider: AiTextProvider
): String {
    val normalizedRequestId = requestId?.trim()?.ifEmpty { null } ?: return message
    return textProvider.messageWithRequestId(message = message, requestId = normalizedRequestId)
}
