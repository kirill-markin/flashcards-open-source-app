package com.flashcardsopensourceapp.feature.settings

enum class CurrentWorkspaceOperation {
    IDLE,
    LOADING,
    SWITCHING,
    SYNCING
}

enum class DestructiveActionState {
    IDLE,
    IN_PROGRESS,
    FAILED
}

enum class CloudPostAuthMode {
    IDLE,
    READY_TO_AUTO_LINK,
    CHOOSE_WORKSPACE,
    PROCESSING,
    FAILED
}
