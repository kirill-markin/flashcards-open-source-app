package com.flashcardsopensourceapp.feature.ai.runtime.errors

sealed interface AiAlertState {
    val title: String
    val message: String
    val showsSettingsAction: Boolean

    data class AiLimitReached(
        val requestId: String,
        val code: String,
        override val title: String,
        override val message: String
    ) : AiAlertState {
        override val showsSettingsAction: Boolean = false
    }

    data class SettingsActionRequired(
        override val title: String,
        override val message: String
    ) : AiAlertState {
        override val showsSettingsAction: Boolean = true
    }

    data class GeneralError(
        override val title: String,
        override val message: String,
        val technicalError: Throwable?
    ) : AiAlertState {
        override val showsSettingsAction: Boolean = false
    }
}

enum class AiAttachmentSettingsSource {
    CAMERA,
    PHOTOS,
    FILES
}

class AiDictationNoSpeechException(
    message: String,
    cause: Throwable?
) : IllegalStateException(message, cause)
