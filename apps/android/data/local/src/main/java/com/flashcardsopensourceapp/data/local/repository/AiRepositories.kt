package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatTurnRequest
import com.flashcardsopensourceapp.data.local.model.AiChatUserContext
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.buildAiChatWireMessages
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteService
import kotlinx.coroutines.flow.Flow
import java.util.TimeZone

private data class AuthorizedAiChatSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

class LocalAiChatRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val cloudRemoteService: CloudRemoteService,
    private val aiChatRemoteService: AiChatRemoteService,
    private val historyStore: AiChatHistoryStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore,
    private val guestSessionStore: GuestAiSessionStore
) : AiChatRepository {
    override fun observeConsent(): Flow<Boolean> {
        return aiChatPreferencesStore.observeConsent()
    }

    override fun hasConsent(): Boolean {
        return aiChatPreferencesStore.hasConsent()
    }

    override fun updateConsent(hasConsent: Boolean) {
        aiChatPreferencesStore.updateConsent(hasConsent = hasConsent)
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return historyStore.loadState(workspaceId = workspaceId)
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        historyStore.saveState(workspaceId = workspaceId, state = state)
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        historyStore.clearState(workspaceId = workspaceId)
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): String {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.transcribeAudio(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            fileName = fileName,
            mediaType = mediaType,
            audioBytes = audioBytes
        )
    }

    override suspend fun warmUpLinkedSession() {
        val cloudSettings = preferencesStore.currentCloudSettings()
        require(cloudSettings.cloudState == CloudAccountState.LINKED) {
            "AI warm-up requires a linked cloud account."
        }
        val configuration = preferencesStore.currentServerConfiguration()
        val storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
            "Cloud account is not signed in."
        }

        refreshedCredentials(
            storedCredentials = storedCredentials,
            authBaseUrl = configuration.authBaseUrl
        )
    }

    override suspend fun streamTurn(
        workspaceId: String?,
        state: AiChatPersistedState,
        totalCards: Int,
        onEvent: suspend (AiChatStreamEvent) -> Unit
    ): AiChatStreamOutcome {
        val session = authorizedSession(workspaceId = workspaceId)
        val request = AiChatTurnRequest(
            messages = buildAiChatWireMessages(messages = state.messages),
            model = state.selectedModelId,
            timezone = TimeZone.getDefault().id,
            devicePlatform = "android",
            chatSessionId = state.chatSessionId,
            codeInterpreterContainerId = state.codeInterpreterContainerId,
            userContext = AiChatUserContext(totalCards = totalCards)
        )

        return aiChatRemoteService.streamTurn(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            request = request,
            onEvent = onEvent
        )
    }

    private suspend fun authorizedSession(workspaceId: String?): AuthorizedAiChatSession {
        val cloudSettings = preferencesStore.currentCloudSettings()
        val configuration = preferencesStore.currentServerConfiguration()

        if (cloudSettings.cloudState == CloudAccountState.LINKED) {
            val credentials = refreshedCredentials(
                storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                    "Cloud account is not signed in."
                },
                authBaseUrl = configuration.authBaseUrl
            )
            return AuthorizedAiChatSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${credentials.idToken}"
            )
        }

        val guestSession = loadOrCreateGuestSession(
            workspaceId = workspaceId,
            configurationApiBaseUrl = configuration.apiBaseUrl
        )
        return AuthorizedAiChatSession(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.guestToken}"
        )
    }

    private fun refreshedCredentials(
        storedCredentials: StoredCloudCredentials,
        authBaseUrl: String
    ): StoredCloudCredentials {
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                nowMillis = System.currentTimeMillis()
            ).not()
        ) {
            return storedCredentials
        }

        return cloudRemoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = authBaseUrl
        ).also(preferencesStore::saveCredentials)
    }

    private suspend fun loadOrCreateGuestSession(
        workspaceId: String?,
        configurationApiBaseUrl: String
    ): StoredGuestAiSession {
        val configuration = preferencesStore.currentServerConfiguration()
        val existingSession = guestSessionStore.loadSession(
            localWorkspaceId = workspaceId,
            configuration = configuration
        )
        if (existingSession != null) {
            markGuestCloudState(
                session = existingSession,
                activeWorkspaceId = workspaceId
            )
            return existingSession
        }

        val createdSession = aiChatRemoteService.createGuestSession(
            apiBaseUrl = configurationApiBaseUrl,
            configurationMode = configuration.mode
        )
        guestSessionStore.saveSession(
            localWorkspaceId = workspaceId,
            session = createdSession
        )
        markGuestCloudState(
            session = createdSession,
            activeWorkspaceId = workspaceId
        )
        return createdSession
    }

    private fun markGuestCloudState(
        session: StoredGuestAiSession,
        activeWorkspaceId: String?
    ) {
        val currentCloudState = preferencesStore.currentCloudSettings().cloudState
        if (currentCloudState == CloudAccountState.LINKED || currentCloudState == CloudAccountState.LINKING_READY) {
            return
        }

        preferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = session.userId,
            linkedWorkspaceId = session.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = activeWorkspaceId
        )
    }
}
