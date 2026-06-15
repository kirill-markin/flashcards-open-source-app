package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.remote.agent.CloudAgentConnectionRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.auth.CloudAuthRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.community.CloudCommunityProfileRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.feedback.CloudFeedbackRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.guest.CloudGuestUpgradeRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.CloudProgressRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.CloudSyncRemoteApi
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudHttpObservationVersions
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.NoopCloudHttpObservability
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.createCloudHttpObservationVersions
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.CloudAccountWorkspaceRemoteApi
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
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import okhttp3.OkHttpClient
import org.json.JSONObject

class CloudRemoteService private constructor(
    okHttpClient: OkHttpClient,
    observability: AppObservability,
    observationVersions: CloudHttpObservationVersions
) : CloudRemoteGateway {
    constructor(
        okHttpClient: OkHttpClient,
        observability: AppObservability,
        appVersion: String,
        versionCode: Int
    ) : this(
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = appVersion,
            versionCode = versionCode
        )
    )

    constructor(okHttpClient: OkHttpClient) : this(
        okHttpClient = okHttpClient,
        observability = NoopCloudHttpObservability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = null,
            versionCode = null
        )
    )

    constructor() : this(okHttpClient = OkHttpClient())

    private val httpClient = CloudJsonHttpClient(
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = observationVersions
    )
    private val authApi = CloudAuthRemoteApi(httpClient = httpClient)
    private val guestUpgradeApi = CloudGuestUpgradeRemoteApi(httpClient = httpClient)
    private val accountWorkspaceApi = CloudAccountWorkspaceRemoteApi(httpClient = httpClient)
    private val progressApi = CloudProgressRemoteApi(httpClient = httpClient)
    private val communityProfileApi = CloudCommunityProfileRemoteApi(httpClient = httpClient)
    private val feedbackApi = CloudFeedbackRemoteApi(httpClient = httpClient)
    private val agentConnectionApi = CloudAgentConnectionRemoteApi(httpClient = httpClient)
    private val syncApi = CloudSyncRemoteApi(httpClient = httpClient)

    override suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
        httpClient.getJson(
            baseUrl = configuration.authBaseUrl,
            path = "/health",
            authorizationHeader = null
        )
        httpClient.getJson(
            baseUrl = configuration.apiBaseUrl,
            path = "/health",
            authorizationHeader = null
        )
    }

    override suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return authApi.sendCode(email = email, authBaseUrl = authBaseUrl)
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return authApi.verifyCode(challenge = challenge, code = code, authBaseUrl = authBaseUrl)
    }

    override suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        return authApi.refreshIdToken(refreshToken = refreshToken, authBaseUrl = authBaseUrl)
    }

    override suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
        guestUpgradeApi.deleteGuestSession(apiBaseUrl = apiBaseUrl, guestToken = guestToken)
    }

    override suspend fun fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String): CloudAccountSnapshot {
        return accountWorkspaceApi.fetchCloudAccount(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        preferences: AccountPreferences
    ): AccountPreferences {
        return accountWorkspaceApi.updateAccountPreferences(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            preferences = preferences
        )
    }

    override suspend fun listLinkedWorkspaces(
        apiBaseUrl: String,
        bearerToken: String
    ): List<CloudWorkspaceSummary> {
        return accountWorkspaceApi.listLinkedWorkspaces(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken)
    }

    override suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        return guestUpgradeApi.prepareGuestUpgrade(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            guestToken = guestToken
        )
    }

    override suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        guestWorkspaceSyncedAndOutboxDrained: Boolean,
        supportsDroppedEntities: Boolean
    ): CloudGuestUpgradeCompletion {
        return guestUpgradeApi.completeGuestUpgrade(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            guestToken = guestToken,
            selection = selection,
            guestWorkspaceSyncedAndOutboxDrained = guestWorkspaceSyncedAndOutboxDrained,
            supportsDroppedEntities = supportsDroppedEntities
        )
    }

    override suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        return accountWorkspaceApi.createWorkspace(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken, name = name)
    }

    override suspend fun selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceSummary {
        return accountWorkspaceApi.selectWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        return accountWorkspaceApi.renameWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            name = name
        )
    }

    override suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        return accountWorkspaceApi.loadWorkspaceDeletePreview(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        return accountWorkspaceApi.deleteWorkspace(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            confirmationText = confirmationText
        )
    }

    override suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        return accountWorkspaceApi.loadWorkspaceResetProgressPreview(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId
        )
    }

    override suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        return accountWorkspaceApi.resetWorkspaceProgress(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            workspaceId = workspaceId,
            confirmationText = confirmationText
        )
    }

    override suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        return progressApi.loadProgressSummary(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone
        )
    }

    override suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        return progressApi.loadProgressSeries(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone,
            from = from,
            to = to
        )
    }

    override suspend fun loadProgressReviewSchedule(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressReviewSchedule {
        return progressApi.loadProgressReviewSchedule(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            timeZone = timeZone
        )
    }

    override suspend fun loadProgressLeaderboard(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudProgressLeaderboard {
        return progressApi.loadProgressLeaderboard(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun loadCommunityProfile(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudCommunityProfile {
        return communityProfileApi.loadCommunityProfile(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun updateCommunityLeaderboardParticipation(
        apiBaseUrl: String,
        authorizationHeader: String,
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile {
        return communityProfileApi.updateCommunityLeaderboardParticipation(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            leaderboardParticipationEnabled = leaderboardParticipationEnabled
        )
    }

    override suspend fun createFriendInvitation(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse {
        return communityProfileApi.createFriendInvitation(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun loadFeedbackState(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudFeedbackState {
        return feedbackApi.loadFeedbackState(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader
        )
    }

    override suspend fun recordFeedbackPromptEvent(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackPromptEventRequest
    ): CloudFeedbackState {
        return feedbackApi.recordFeedbackPromptEvent(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun submitFeedback(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: CloudFeedbackSubmissionRequest
    ): CloudFeedbackState {
        return feedbackApi.submitFeedback(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            request = request
        )
    }

    override suspend fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String) {
        accountWorkspaceApi.deleteAccount(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            confirmationText = confirmationText
        )
    }

    override suspend fun listAgentConnections(
        apiBaseUrl: String,
        bearerToken: String
    ): AgentApiKeyConnectionsResult {
        return agentConnectionApi.listAgentConnections(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken)
    }

    override suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        return agentConnectionApi.revokeAgentConnection(
            apiBaseUrl = apiBaseUrl,
            bearerToken = bearerToken,
            connectionId = connectionId
        )
    }

    override suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        return syncApi.push(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        return syncApi.pull(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        return syncApi.bootstrapPull(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        return syncApi.bootstrapPush(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        return syncApi.pullReviewHistory(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }

    override suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        return syncApi.importReviewHistory(
            apiBaseUrl = apiBaseUrl,
            authorizationHeader = authorizationHeader,
            workspaceId = workspaceId,
            body = body
        )
    }
}
