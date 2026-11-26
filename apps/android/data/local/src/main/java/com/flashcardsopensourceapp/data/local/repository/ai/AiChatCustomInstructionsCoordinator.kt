package com.flashcardsopensourceapp.data.local.repository.ai

import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.store.AiChatCustomInstructionsStore
import com.flashcardsopensourceapp.data.local.ai.store.makeAiChatHistoryScopedWorkspaceId
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.database.cards.WorkspaceDao
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructions
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatCustomInstructionsScopeChangedException
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.isSameCloudService
import com.flashcardsopensourceapp.data.local.model.sync.preservingLocalAccountIdentity
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.withContext

internal class AiChatCustomInstructionsCoordinator(
    private val workspaceDao: WorkspaceDao,
    private val preferencesStore: CloudPreferencesStore,
    private val cloudRemoteService: CloudRemoteGateway,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val operationCoordinator: CloudOperationCoordinator,
    private val aiChatRemoteService: AiChatRemoteService,
    private val loadLinkedSession: suspend () -> AuthorizedAiChatSession
) {
    private val customInstructionsStore = AiChatCustomInstructionsStore()

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observe(workspaceId: String): Flow<String?> {
        return observeScope().flatMapLatest { scope ->
            if (scope?.workspaceId == workspaceId) {
                customInstructionsStore.observe(scopeId = scope.scopeId)
            } else {
                flowOf(value = null)
            }
        }
    }

    fun observeScope(): Flow<AiChatCustomInstructionsScope?> {
        val pendingUpgrade = preferencesStore.observePendingGuestUpgrade().catch { error ->
            AiChatDiagnosticsLogger.error(
                event = "ai_chat_custom_instructions_recovery_check_failed",
                fields = emptyList(),
                throwable = error
            )
            emit(true)
        }
        return combine(
            workspaceDao.observeWorkspaces(),
            preferencesStore.observeCloudSettings(),
            preferencesStore.observeServerConfiguration(),
            pendingUpgrade
        ) { workspaces, cloudSettings, configuration, upgradePending ->
            if (upgradePending) {
                null
            } else {
                scopeFor(cloudSettings = cloudSettings, configuration = configuration)
                    ?.takeIf { scope -> workspaces.any { workspace -> workspace.workspaceId == scope.workspaceId } }
            }
        }.distinctUntilChanged()
    }

    suspend fun load(scope: AiChatCustomInstructionsScope): AiChatCustomInstructions {
        val session = withAuthorizedEditorSession(scope = scope) { session -> session }
        return recordRead(
            scope = scope,
            request = {
                aiChatRemoteService.loadCustomInstructions(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    workspaceId = scope.workspaceId
                )
            },
            customInstructions = AiChatCustomInstructions::customInstructions
        )
    }

    suspend fun save(
        scope: AiChatCustomInstructionsScope,
        customInstructions: String
    ): AiChatCustomInstructions {
        return withAuthorizedEditorSession(scope = scope) { session ->
            currentCoroutineContext().ensureActive()
            // Keep conversion behind the write even if the editor leaves while the POST is in flight.
            withContext(NonCancellable) {
                recordResponse(
                    scope = scope,
                    request = {
                        aiChatRemoteService.saveCustomInstructions(
                            apiBaseUrl = session.apiBaseUrl,
                            authorizationHeader = session.authorizationHeader,
                            workspaceId = scope.workspaceId,
                            customInstructions = customInstructions.takeIf(String::isNotBlank)
                        )
                    },
                    observedAt = customInstructionsStore::stamp,
                    customInstructions = AiChatCustomInstructions::customInstructions
                )
            }
        }
    }

    suspend fun captureScopeForWorkspace(workspaceId: String): AiChatCustomInstructionsScope? {
        return currentScopeOrNull()?.also { scope -> requireWorkspace(scope = scope, workspaceId = workspaceId) }
    }

    fun requireWorkspace(scope: AiChatCustomInstructionsScope, workspaceId: String) {
        if (scope.workspaceId != workspaceId) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    suspend fun confirmPreparedScope(
        previousScope: AiChatCustomInstructionsScope?,
        session: AuthorizedAiChatSession
    ): AiChatCustomInstructionsScope {
        val scope = currentScopeOrNull() ?: throw AiChatCustomInstructionsScopeChangedException()
        if (previousScope != null && scope != previousScope) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
        requireMatchingSession(scope = scope, session = session)
        return scope
    }

    suspend fun currentScopeOrNull(): AiChatCustomInstructionsScope? {
        if (preferencesStore.hasPendingGuestUpgrade()) {
            return null
        }
        return scopeFor(
            cloudSettings = preferencesStore.currentCloudSettings(),
            configuration = preferencesStore.currentServerConfiguration()
        )?.takeIf { scope -> workspaceDao.loadWorkspaceById(workspaceId = scope.workspaceId) != null }
    }

    private fun scopeFor(
        cloudSettings: CloudSettings,
        configuration: CloudServiceConfiguration
    ): AiChatCustomInstructionsScope? {
        if (cloudSettings.cloudState != CloudAccountState.LINKED && cloudSettings.cloudState != CloudAccountState.GUEST) {
            return null
        }
        val workspaceId = cloudSettings.activeWorkspaceId ?: return null
        val userId = cloudSettings.linkedUserId ?: return null
        val historyScope = makeAiChatHistoryScopedWorkspaceId(workspaceId = workspaceId, cloudSettings = cloudSettings)
        return AiChatCustomInstructionsScope(
            workspaceId = workspaceId,
            scopeId = "${configuration.mode}::${configuration.apiBaseUrl}::${cloudSettings.installationId}::$historyScope",
            userId = userId,
            cloudState = cloudSettings.cloudState,
            configuration = configuration
        )
    }

    private suspend fun <T : Any> withAuthorizedEditorSession(
        scope: AiChatCustomInstructionsScope,
        action: suspend (AuthorizedAiChatSession) -> T
    ): T {
        if (scope.cloudState != CloudAccountState.LINKED) {
            return operationCoordinator.runExclusive {
                val session = authorizedScopedSession(scope = scope)
                requireMatchingSession(scope = scope, session = session)
                action(session)
            }
        }

        repeat(2) {
            val (settings, session) = operationCoordinator.runExclusive {
                val session = authorizedScopedSession(scope = scope)
                preferencesStore.currentCloudSettings() to session
            }
            // Keep account and workspace paging outside the lock used by sync and conversion.
            val account = try {
                Result.success(
                    cloudRemoteService.fetchCloudAccount(
                        apiBaseUrl = session.apiBaseUrl,
                        authorizationHeader = session.authorizationHeader
                    ).preservingLocalAccountIdentity(settings = settings)
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Result.failure(error)
            }
            val result = operationCoordinator.runExclusive {
                requireCurrentScope(scope = scope)
                val credentials = withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
                    ?: throw AiChatCustomInstructionsScopeChangedException()
                if (session.authorizationHeader != "Bearer ${credentials.idToken}") {
                    return@runExclusive null
                }
                if (session.apiBaseUrl != scope.configuration.apiBaseUrl || account.getOrThrow().userId != scope.userId) {
                    throw AiChatCustomInstructionsScopeChangedException()
                }
                if (credentials.idTokenExpiresAtMillis <= System.currentTimeMillis()) {
                    throw IOException("The cloud credential expired while verifying chat instructions. Try again.")
                }
                action(session)
            }
            if (result != null) {
                return result
            }
        }
        throw IOException("The cloud credential changed again while verifying chat instructions. Try again.")
    }

    suspend fun authorizedScopedSession(scope: AiChatCustomInstructionsScope): AuthorizedAiChatSession =
        operationCoordinator.runExclusive {
            requireCurrentScope(scope = scope)
            val session = when (scope.cloudState) {
                CloudAccountState.GUEST -> {
                    val guest = requireWorkspaceGuestSession(scope = scope)
                    AuthorizedAiChatSession(
                        apiBaseUrl = guest.apiBaseUrl,
                        authorizationHeader = "Guest ${guest.guestToken}"
                    )
                }

                CloudAccountState.LINKED -> loadLinkedSession()

                else -> throw AiChatCustomInstructionsScopeChangedException()
            }
            requireCurrentScope(scope = scope)
            session
        }

    private suspend fun requireWorkspaceGuestSession(scope: AiChatCustomInstructionsScope): StoredGuestAiSession {
        return cloudGuestSessionCoordinator.loadWorkspaceGuestSession(workspaceId = scope.workspaceId)
            ?.takeIf { guest -> !guest.isAnalyticsOnly && guest.userId == scope.userId && guest.workspaceId == scope.workspaceId }
            ?: throw AiChatCustomInstructionsScopeChangedException()
    }

    private suspend fun requireCurrentScope(scope: AiChatCustomInstructionsScope) {
        if (currentScopeOrNull() != scope) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    private suspend fun requireMatchingSession(
        scope: AiChatCustomInstructionsScope,
        session: AuthorizedAiChatSession
    ) {
        requireCurrentScope(scope = scope)
        if (!matchesCredential(scope = scope, session = session)) {
            throw AiChatCustomInstructionsScopeChangedException()
        }
    }

    private suspend fun matchesCredential(
        scope: AiChatCustomInstructionsScope,
        session: AuthorizedAiChatSession
    ): Boolean {
        return when (scope.cloudState) {
            CloudAccountState.GUEST -> {
                val guest = requireWorkspaceGuestSession(scope = scope)
                session.authorizationHeader == "Guest ${guest.guestToken}" && isSameCloudService(
                    leftMode = guest.configurationMode,
                    leftApiBaseUrl = session.apiBaseUrl,
                    rightMode = scope.configuration.mode,
                    rightApiBaseUrl = scope.configuration.apiBaseUrl
                )
            }

            CloudAccountState.LINKED -> {
                val credentials = withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
                credentials != null && session.apiBaseUrl == scope.configuration.apiBaseUrl &&
                    session.authorizationHeader == "Bearer ${credentials.idToken}" &&
                    credentials.idTokenExpiresAtMillis > System.currentTimeMillis()
            }

            else -> false
        }
    }

    suspend fun <T> recordScopedRead(
        scope: AiChatCustomInstructionsScope,
        request: suspend (AuthorizedAiChatSession) -> T,
        customInstructions: (T) -> String?
    ): T {
        val session = authorizedScopedSession(scope = scope)
        return recordRead(
            scope = scope,
            request = { request(session) },
            customInstructions = customInstructions
        )
    }

    suspend fun <T> recordRead(
        scope: AiChatCustomInstructionsScope,
        request: suspend () -> T,
        customInstructions: (T) -> String?
    ): T {
        val observedAt = customInstructionsStore.stamp()
        return recordResponse(
            scope = scope,
            request = request,
            observedAt = { observedAt },
            customInstructions = customInstructions
        )
    }

    private suspend fun <T> recordResponse(
        scope: AiChatCustomInstructionsScope,
        request: suspend () -> T,
        observedAt: () -> Long,
        customInstructions: (T) -> String?
    ): T {
        val response = try {
            request()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            operationCoordinator.runExclusive {
                requireCurrentScope(scope = scope)
            }
            throw error
        }
        return operationCoordinator.runExclusive {
            requireCurrentScope(scope = scope)
            customInstructionsStore.record(
                scopeId = scope.scopeId,
                observedAt = observedAt(),
                customInstructions = customInstructions(response)
            )
            response
        }
    }
}
