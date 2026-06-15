package com.flashcardsopensourceapp.data.local.cloud.remote.community

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildCommunityFriendInvitationsCloudPath
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildCommunityProfileCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import org.json.JSONObject

internal class CloudCommunityProfileRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun loadCommunityProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudCommunityProfile {
        val response = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildCommunityProfileCloudPath(),
            authorizationHeader = authorizationHeader
        )
        return response.toCloudCommunityProfile(fieldPath = "communityProfile")
    }

    suspend fun updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile {
        val response = httpClient.patchJson(
            baseUrl = apiBaseUrl,
            path = buildCommunityProfileCloudPath(),
            authorizationHeader = authorizationHeader,
            body = JSONObject()
                .put("leaderboardParticipationEnabled", leaderboardParticipationEnabled)
        )
        return response.toCloudCommunityProfile(fieldPath = "communityProfile")
    }

    suspend fun createFriendInvitation(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = buildCommunityFriendInvitationsCloudPath(),
            authorizationHeader = authorizationHeader,
            body = buildCloudFriendInvitationCreateRequest(request = request)
        )
        return parseCloudFriendInvitationCreateResponse(
            response = response,
            fieldPath = "friendInvitation"
        )
    }
}

internal fun buildCloudFriendInvitationCreateRequest(
    request: CloudFriendInvitationCreateRequest
): JSONObject {
    return JSONObject()
        .put("inviteeDisplayName", request.inviteeDisplayName)
}

internal fun parseCloudFriendInvitationCreateResponse(
    response: JSONObject,
    fieldPath: String
): CloudFriendInvitationCreateResponse {
    return CloudFriendInvitationCreateResponse(
        inviteUrl = response.requireCloudString("inviteUrl", "$fieldPath.inviteUrl"),
        expiresAt = response.requireCloudString("expiresAt", "$fieldPath.expiresAt")
    )
}

private fun JSONObject.toCloudCommunityProfile(
    fieldPath: String
): CloudCommunityProfile {
    return CloudCommunityProfile(
        publicProfileId = requireCloudString("publicProfileId", "$fieldPath.publicProfileId"),
        anonymousDisplayName = requireCloudString("anonymousDisplayName", "$fieldPath.anonymousDisplayName"),
        leaderboardParticipationEnabled = requireCloudBoolean(
            "leaderboardParticipationEnabled",
            "$fieldPath.leaderboardParticipationEnabled"
        ),
        linkedAccountRequiredForLeaderboard = requireCloudBoolean(
            "linkedAccountRequiredForLeaderboard",
            "$fieldPath.linkedAccountRequiredForLeaderboard"
        )
    )
}
