package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONObject

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
    val syncConflict: CloudSyncConflictDetails?
) : Exception(message)

interface CloudRemoteGateway {
    suspend fun validateConfiguration(configuration: CloudServiceConfiguration)
    suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String)
    suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot
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
