package com.flashcardsopensourceapp.feature.settings.access

enum class AccessCapability {
    CAMERA,
    MICROPHONE,
    PHOTOS,
    FILES
}

enum class AccessStatus {
    ALLOWED,
    ASK_EVERY_TIME,
    BLOCKED,
    SYSTEM_PICKER,
    UNAVAILABLE
}

data class AccessCapabilityUiState(
    val capability: AccessCapability,
    val title: String,
    val summary: String,
    val status: AccessStatus,
    val guidance: String,
    val primaryActionLabel: String?
)
