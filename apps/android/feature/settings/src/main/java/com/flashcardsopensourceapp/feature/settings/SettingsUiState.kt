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
    val reviewReactionAnimationsEnabled: Boolean,
    val aiChatComposerSuggestionsEnabled: Boolean,
    val canManageAccountPreferences: Boolean,
    val isTestModeEnabled: Boolean
)
