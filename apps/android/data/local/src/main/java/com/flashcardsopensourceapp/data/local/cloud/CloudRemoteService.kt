package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
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
import org.json.JSONObject

class CloudRemoteService : CloudRemoteGateway {
    private val httpClient = CloudJsonHttpClient()
    private val authApi = CloudAuthRemoteApi(httpClient = httpClient)
    private val guestUpgradeApi = CloudGuestUpgradeRemoteApi(httpClient = httpClient)
    private val accountWorkspaceApi = CloudAccountWorkspaceRemoteApi(httpClient = httpClient)
    private val progressApi = CloudProgressRemoteApi(httpClient = httpClient)
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

    override suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        return accountWorkspaceApi.fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken)
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
