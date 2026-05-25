package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider

internal class CloudAgentConnectionsReader(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val sessionProvider: CloudSessionProvider
) {
    suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Agent connections are available only for linked cloud accounts."
        }
        val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
        return remoteService.listAgentConnections(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken
        )
    }

    suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        require(preferencesStore.currentCloudSettings().cloudState == CloudAccountState.LINKED) {
            "Agent connections are available only for linked cloud accounts."
        }
        val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
        return remoteService.revokeAgentConnection(
            apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
            bearerToken = authenticatedSession.credentials.idToken,
            connectionId = connectionId
        )
    }
}
