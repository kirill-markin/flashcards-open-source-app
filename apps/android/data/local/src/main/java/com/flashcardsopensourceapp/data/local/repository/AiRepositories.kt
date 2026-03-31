package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.ai.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteService
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import kotlinx.coroutines.flow.Flow
import java.util.TimeZone

private data class AuthorizedAiChatSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private data class PreparedGuestAiSession(
    val session: StoredGuestAiSession,
    val shouldSync: Boolean
)

class LocalAiChatRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val cloudRemoteService: CloudRemoteService,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val syncRepository: SyncRepository,
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

    override suspend fun prepareSessionForAi(workspaceId: String?) {
        val cloudSettings = preferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState == CloudAccountState.LINKED) {
            val configuration = preferencesStore.currentServerConfiguration()
            val storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                "Cloud account is not signed in."
            }
            refreshedCredentials(
                storedCredentials = storedCredentials,
                authBaseUrl = configuration.authBaseUrl
            )
            return
        }

        val configuration = preferencesStore.currentServerConfiguration()
        val preparedGuestSession = prepareGuestSession(
            workspaceId = workspaceId,
            configurationApiBaseUrl = configuration.apiBaseUrl
        )
        if (preparedGuestSession.shouldSync) {
            syncRepository.syncNow()
        }
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return historyStore.loadState(workspaceId = historyScopeId(workspaceId = workspaceId))
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        historyStore.saveState(workspaceId = historyScopeId(workspaceId = workspaceId), state = state)
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        historyStore.clearState(workspaceId = historyScopeId(workspaceId = workspaceId))
    }

    override suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot? {
        val session = authorizedSession(workspaceId = workspaceId)
        return try {
            aiChatRemoteService.loadSnapshot(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                sessionId = sessionId
            )
        } catch (error: AiChatRemoteException) {
            if (error.statusCode == 404) {
                AiChatDiagnosticsLogger.warn(
                    event = "load_snapshot_missing_session",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "sessionId" to sessionId,
                        "apiBaseUrl" to session.apiBaseUrl,
                        "requestId" to error.requestId,
                        "statusCode" to error.statusCode.toString(),
                        "code" to error.code,
                        "stage" to error.stage
                    )
                )
                null
            } else {
                AiChatDiagnosticsLogger.error(
                    event = "load_snapshot_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "sessionId" to sessionId,
                        "apiBaseUrl" to session.apiBaseUrl,
                        "requestId" to error.requestId,
                        "statusCode" to error.statusCode?.toString(),
                        "code" to error.code,
                        "stage" to error.stage,
                        "responseBody" to error.responseBody
                    ),
                    throwable = error
                )
                throw error
            }
        }
    }

    override suspend fun createNewSession(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.createNewSession(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId
        )
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult {
        val session = authorizedSession(workspaceId = workspaceId)
        return aiChatRemoteService.transcribeAudio(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId,
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

    override suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<AiChatContentPart>,
        onAccepted: suspend (String, com.flashcardsopensourceapp.data.local.model.AiChatServerConfig?) -> Unit,
        onEvent: suspend (AiChatStreamEvent) -> Unit
    ): AiChatStreamOutcome {
        val session = authorizedSession(workspaceId = workspaceId)
        val isLinkedSession = session.authorizationHeader.startsWith(prefix = "Bearer ")
        val resolvedSessionId = state.chatSessionId.ifBlank {
            require(isLinkedSession.not()) {
                "Linked AI chat session is unavailable."
            }

            aiChatRemoteService.loadSnapshot(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                sessionId = null
            ).sessionId
        }
        val request = AiChatStartRunRequest(
            sessionId = resolvedSessionId,
            clientRequestId = java.util.UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(content = content),
            timezone = TimeZone.getDefault().id,
        )

        AiChatDiagnosticsLogger.info(
            event = "start_run_requested",
            fields = listOf(
                "workspaceId" to workspaceId,
                "chatSessionId" to request.sessionId,
                "apiBaseUrl" to session.apiBaseUrl,
                "messageCount" to state.messages.size.toString(),
                "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = content)
            )
        )

        return try {
            aiChatRemoteService.startRun(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                request = request,
                onAccepted = onAccepted,
                onEvent = onEvent
            )
        } catch (error: AiChatRemoteException) {
            AiChatDiagnosticsLogger.error(
                event = "start_run_failed",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "chatSessionId" to request.sessionId,
                    "apiBaseUrl" to session.apiBaseUrl,
                    "messageCount" to state.messages.size.toString(),
                    "contentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = content),
                    "requestId" to error.requestId,
                    "statusCode" to error.statusCode?.toString(),
                    "code" to error.code,
                    "stage" to error.stage,
                    "responseBody" to error.responseBody
                ),
                throwable = error
            )
            throw error
        }
    }

    override suspend fun stopRun(workspaceId: String?, sessionId: String) {
        val session = authorizedSession(workspaceId = workspaceId)
        aiChatRemoteService.stopRun(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = session.authorizationHeader,
            sessionId = sessionId
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

        val guestSession = loadGuestSessionForCurrentConfiguration(
            workspaceId = workspaceId
        ) ?: run {
            val preparedGuestSession = prepareGuestSession(
                workspaceId = workspaceId,
                configurationApiBaseUrl = configuration.apiBaseUrl
            )
            if (preparedGuestSession.shouldSync) {
                syncRepository.syncNow()
            }
            preparedGuestSession.session
        }
        return AuthorizedAiChatSession(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.guestToken}"
        )
    }

    private fun historyScopeId(workspaceId: String?): String {
        return makeAiChatHistoryScopedWorkspaceId(
            workspaceId = workspaceId,
            cloudSettings = preferencesStore.currentCloudSettings()
        )
    }

    private suspend fun refreshedCredentials(
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
        val existingSession = loadGuestSessionForCurrentConfiguration(workspaceId = workspaceId)
        if (existingSession != null) {
            return existingSession
        }

        val createdSession = aiChatRemoteService.createGuestSession(
            apiBaseUrl = configurationApiBaseUrl,
            configurationMode = configuration.mode
        )
        return createdSession
    }

    private suspend fun prepareGuestSession(
        workspaceId: String?,
        configurationApiBaseUrl: String
    ): PreparedGuestAiSession {
        return operationCoordinator.runExclusive {
            val guestSession = loadOrCreateGuestSession(
                workspaceId = workspaceId,
                configurationApiBaseUrl = configurationApiBaseUrl
            )
            PreparedGuestAiSession(
                session = guestSession,
                shouldSync = finishGuestCloudLinkIfNeededLocked(session = guestSession)
            )
        }
    }

    private fun loadGuestSessionForCurrentConfiguration(workspaceId: String?): StoredGuestAiSession? {
        val configuration = preferencesStore.currentServerConfiguration()
        if (workspaceId.isNullOrBlank()) {
            return guestSessionStore.loadAnySession(configuration = configuration)
        }

        return guestSessionStore.loadSession(
            localWorkspaceId = workspaceId,
            configuration = configuration
        )
    }

    private suspend fun finishGuestCloudLinkIfNeededLocked(session: StoredGuestAiSession): Boolean {
        val currentCloudSettings = preferencesStore.currentCloudSettings()
        val currentWorkspace = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        )
        val isAlreadyGuestLinked = currentCloudSettings.cloudState == CloudAccountState.GUEST
            && currentWorkspace?.workspaceId == session.workspaceId
            && currentCloudSettings.linkedUserId == session.userId

        if (isAlreadyGuestLinked) {
            guestSessionStore.saveSession(localWorkspaceId = session.workspaceId, session = session)
            markGuestCloudState(session = session, activeWorkspaceId = session.workspaceId)
            return false
        }

        val bootstrapProbe = bootstrapGuestWorkspace(
            session = session,
            installationId = currentCloudSettings.installationId
        )
        val workspaceSummary = guestWorkspaceSummary(
            currentWorkspaceId = currentWorkspace?.workspaceId,
            currentWorkspaceName = currentWorkspace?.name,
            currentWorkspaceCreatedAtMillis = currentWorkspace?.createdAtMillis,
            session = session
        )
        syncLocalStore.migrateLocalShellToLinkedWorkspace(
            workspace = workspaceSummary,
            remoteWorkspaceIsEmpty = bootstrapProbe.remoteIsEmpty
        )
        if (currentWorkspace?.workspaceId != null && currentWorkspace.workspaceId != session.workspaceId) {
            guestSessionStore.clearSession(localWorkspaceId = currentWorkspace.workspaceId)
        }
        guestSessionStore.saveSession(localWorkspaceId = session.workspaceId, session = session)
        markGuestCloudState(session = session, activeWorkspaceId = session.workspaceId)
        return true
    }

    private suspend fun bootstrapGuestWorkspace(
        session: StoredGuestAiSession,
        installationId: String
    ): com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse {
        return runGuestBootstrapPull(
            session = session,
            installationId = installationId
        )
    }

    private suspend fun runGuestBootstrapPull(
        session: StoredGuestAiSession,
        installationId: String
    ): com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse {
        return cloudRemoteService.bootstrapPull(
            apiBaseUrl = session.apiBaseUrl,
            authorizationHeader = "Guest ${session.guestToken}",
            workspaceId = session.workspaceId,
            body = org.json.JSONObject()
                .put("mode", "pull")
                .put("installationId", installationId)
                .put("platform", "android")
                .put("appVersion", "1.0.0")
                .put("cursor", org.json.JSONObject.NULL)
                .put("limit", 1)
        )
    }

    private fun guestWorkspaceSummary(
        currentWorkspaceId: String?,
        currentWorkspaceName: String?,
        currentWorkspaceCreatedAtMillis: Long?,
        session: StoredGuestAiSession
    ): CloudWorkspaceSummary {
        val workspaceName = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceName ?: "Personal"
        } else {
            currentWorkspaceName ?: "Personal"
        }
        val createdAtMillis = if (currentWorkspaceId == session.workspaceId) {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        } else {
            currentWorkspaceCreatedAtMillis ?: System.currentTimeMillis()
        }
        return CloudWorkspaceSummary(
            workspaceId = session.workspaceId,
            name = workspaceName,
            createdAtMillis = createdAtMillis,
            isSelected = true
        )
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
