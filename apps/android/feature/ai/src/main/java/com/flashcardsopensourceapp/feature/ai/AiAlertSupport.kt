package com.flashcardsopensourceapp.feature.ai

sealed interface AiAlertState {
    val title: String
    val message: String
    val showsSettingsAction: Boolean

    data class SettingsActionRequired(
        override val title: String,
        override val message: String
    ) : AiAlertState {
        override val showsSettingsAction: Boolean = true
    }

    data class GeneralError(
        override val title: String,
        override val message: String
    ) : AiAlertState {
        override val showsSettingsAction: Boolean = false
    }
}

enum class AiAttachmentSettingsSource {
    CAMERA,
    PHOTOS,
    FILES
}
