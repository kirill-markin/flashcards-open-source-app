package com.flashcardsopensourceapp.feature.ai

sealed interface AiAlertState {
    val title: String
    val message: String
    val showsSettingsAction: Boolean

    data object MicrophoneSettings : AiAlertState {
        override val title: String = "Microphone access needed"
        override val message: String =
            "Microphone access is turned off for Flashcards Open Source App. Open Settings to allow it."
        override val showsSettingsAction: Boolean = true
    }

    data class AttachmentSettings(
        val source: AiAttachmentSettingsSource
    ) : AiAlertState {
        override val title: String
            get() = source.title
        override val message: String
            get() = source.message
        override val showsSettingsAction: Boolean = true
    }

    data class GeneralError(
        override val message: String
    ) : AiAlertState {
        override val title: String = "Error"
        override val showsSettingsAction: Boolean = false
    }
}

enum class AiAttachmentSettingsSource {
    CAMERA,
    PHOTOS,
    FILES;

    val title: String
        get() = when (this) {
            CAMERA -> "Camera access needed"
            PHOTOS -> "Photo access needed"
            FILES -> "File access needed"
        }

    val message: String
        get() = when (this) {
            CAMERA -> "Camera access is turned off for Flashcards Open Source App. Open Settings to allow it."
            PHOTOS -> "Photo access is turned off for Flashcards Open Source App. Open Settings to allow it."
            FILES -> "File access is turned off for Flashcards Open Source App. Open Settings to allow it."
        }
}
