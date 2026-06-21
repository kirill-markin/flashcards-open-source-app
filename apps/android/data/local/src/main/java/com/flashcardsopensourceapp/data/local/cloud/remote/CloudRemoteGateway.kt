package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.core.observability.AndroidAlreadyObservedThrowable
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackPromptEventRequest
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackState
import com.flashcardsopensourceapp.data.local.model.feedback.CloudFeedbackSubmissionRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import org.json.JSONObject

class CloudHealthValidationException(
    message: String,
    cause: Throwable?
) : Exception(message, cause)

data class CloudSyncConflictDetails(
    val entityType: SyncEntityType?,
    val entityId: String?,
    val entryIndex: Int?,
    val reviewEventIndex: Int?,
    val recoverable: Boolean?,
    val conflictingWorkspaceId: String?,
    val remoteIsEmpty: Boolean?
)

class CloudRemoteException(
    message: String,
    val statusCode: Int?,
    val responseBody: String?,
    val errorCode: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?,
    override val androidObservationAlreadyCaptured: Boolean
) : Exception(message), AndroidAlreadyObservedThrowable

interface CloudRemoteGateway {
    suspend fun validateConfiguration(configuration: CloudServiceConfiguration)
    suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String)
    suspend fun fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String): CloudAccountSnapshot
    suspend fun updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        preferences: AccountPreferences
    ): AccountPreferences
    suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary>
    suspend fun prepareGuestUpgrade(apiBaseUrl: String, bearerToken: String, guestToken: String): CloudGuestUpgradeMode
    suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        guestWorkspaceSyncedAndOutboxDrained: Boolean,
        supportsDroppedEntities: Boolean
    ): CloudGuestUpgradeCompletion

    suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary
    suspend fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary
    suspend fun renameWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String, name: String): CloudWorkspaceSummary
    suspend fun loadWorkspaceDeletePreview(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceDeletePreview
    suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult
    suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview
    suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult
    suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary
    suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries
    suspend fun loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressReviewSchedule
    suspend fun loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressLeaderboard
    suspend fun loadProgressStreakLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressStreakLeaderboard
    suspend fun loadProgressLeaderboardProfile(
        apiBaseUrl: String,
        authorizationHeader: String,
        publicProfileId: String
    ): CloudProgressLeaderboardProfile
    suspend fun loadCommunityProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudCommunityProfile
    suspend fun updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile
    suspend fun createFriendInvitation(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse
    suspend fun loadFeedbackState(apiBaseUrl: String, authorizationHeader: String): CloudFeedbackState
    suspend fun recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackPromptEventRequest
    ): CloudFeedbackState
    suspend fun submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackSubmissionRequest
    ): CloudFeedbackState

    suspend fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String)
    suspend fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult
    suspend fun revokeAgentConnection(apiBaseUrl: String, bearerToken: String, connectionId: String): AgentApiKeyConnectionsResult
    suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse
    suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse
    suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse

    suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse

    suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse

    suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse
}
