package com.flashcardsopensourceapp.feature.settings.leaderboard

data class LeaderboardParticipationUiState(
    val canManageLeaderboardParticipation: Boolean,
    val leaderboardParticipationEnabled: Boolean?,
    val errorMessage: String,
    val isUpdating: Boolean
)
