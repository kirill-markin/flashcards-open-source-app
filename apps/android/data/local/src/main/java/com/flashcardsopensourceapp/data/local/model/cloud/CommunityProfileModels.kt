package com.flashcardsopensourceapp.data.local.model.cloud

data class CloudCommunityProfile(
    val publicProfileId: String,
    val anonymousDisplayName: String,
    val leaderboardParticipationEnabled: Boolean,
    val linkedAccountRequiredForLeaderboard: Boolean
)

data class CloudFriendInvitationCreateRequest(
    val inviteeDisplayName: String
)

data class CloudFriendInvitationCreateResponse(
    val inviteUrl: String,
    val expiresAt: String
)
