package com.flashcardsopensourceapp.data.local.model.cloud

data class CloudCommunityProfile(
    val publicProfileId: String,
    val anonymousDisplayName: String,
    val leaderboardParticipationEnabled: Boolean,
    val linkedAccountRequiredForLeaderboard: Boolean
)
