package com.flashcardsopensourceapp.data.local.cloud.remote.community

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildCommunityProfileCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
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
