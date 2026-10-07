package com.flashcardsopensourceapp.feature.settings

enum class SettingsFriendInviteAvailability {
    LOADING,
    AVAILABLE,
    SIGN_IN_REQUIRED
}

data class SettingsUiState(
    val currentWorkspaceName: String,
    val workspaceName: String,
    val cardCount: Int,
    val deckCount: Int,
    val storageLabel: String,
    val syncStatusText: String,
    val accountStatusTitle: String,
    val accountStatusAttentionCount: Int,
    val friendInviteAvailability: SettingsFriendInviteAvailability,
    /** Effective value: on while the plan is known free; the saved choice applies again with Premium. */
    val reviewReactionAnimationsEnabled: Boolean,
    /** The resolved answer the switch shows: an unanswered account reads as on. */
    val productAnalyticsEnabled: Boolean,
    /** Effective value, gated like [reviewReactionAnimationsEnabled]. */
    val aiChatComposerSuggestionsEnabled: Boolean,
    val ownOpenAiKeyEnabled: Boolean,
    val canManageAccountPreferences: Boolean,
    val isTestModeEnabled: Boolean
)
