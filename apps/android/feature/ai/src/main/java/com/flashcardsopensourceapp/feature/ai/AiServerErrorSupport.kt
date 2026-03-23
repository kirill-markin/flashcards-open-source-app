package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode

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
    surface: AiErrorSurface
): String? {
    return when (surface) {
        AiErrorSurface.CHAT -> {
            if (aiChatAvailabilityErrorCodes.contains(code).not()) {
                return null
            }

            when (configurationMode) {
                CloudServiceConfigurationMode.OFFICIAL ->
                    "AI is temporarily unavailable on the official server. Try again later."

                CloudServiceConfigurationMode.CUSTOM ->
                    "AI is unavailable on this server. Contact the server operator."
            }
        }

        AiErrorSurface.DICTATION -> {
            if (aiChatDictationAvailabilityErrorCodes.contains(code).not()) {
                return null
            }

            when (configurationMode) {
                CloudServiceConfigurationMode.OFFICIAL ->
                    "AI dictation is temporarily unavailable on the official server. Try again later."

                CloudServiceConfigurationMode.CUSTOM ->
                    "AI dictation is unavailable on this server. Contact the server operator."
            }
        }
    }
}

fun makeAiChatUserFacingErrorMessage(
    rawMessage: String,
    code: String?,
    requestId: String?,
    configurationMode: CloudServiceConfigurationMode,
    surface: AiErrorSurface
): String {
    val mappedMessage = if (code == null) {
        null
    } else {
        aiChatAvailabilityMessage(
            code = code,
            configurationMode = configurationMode,
            surface = surface
        )
    }

    return appendAiRequestIdReference(
        message = mappedMessage ?: rawMessage,
        requestId = requestId
    )
}

private fun appendAiRequestIdReference(
    message: String,
    requestId: String?
): String {
    val normalizedRequestId = requestId?.trim()?.ifEmpty { null } ?: return message
    return "$message Request ID: $normalizedRequestId"
}
