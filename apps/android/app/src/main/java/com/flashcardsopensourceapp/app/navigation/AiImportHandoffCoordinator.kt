package com.flashcardsopensourceapp.app.navigation

import androidx.annotation.MainThread
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStorageException
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.ai.AiImportTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.feature.ai.AiImport
import com.flashcardsopensourceapp.feature.ai.AiImportOrigin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

internal class AiImportHandoffCoordinator(
    private val workspaceRepository: WorkspaceRepository,
    private val cloudPreferencesStore: CloudPreferencesStore,
    private val guestAiSessionStore: GuestAiSessionStore,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val cloudOperationCoordinator: CloudOperationCoordinator,
    private val appHandoffCoordinator: AppHandoffCoordinator
) {
    suspend fun captureOrigin(): AiImportOrigin? = cloudOperationCoordinator.runExclusive {
        val workspaceId = workspaceRepository.observeWorkspace().first()?.workspaceId ?: return@runExclusive null
        val configuration = cloudPreferencesStore.currentServerConfiguration()
        val cloudSettings = resolveAiImportCloudSettings(
            workspaceId = workspaceId,
            settings = cloudPreferencesStore.currentCloudSettings(),
            configuration = configuration
        ) ?: return@runExclusive null
        AiImportOrigin(
            workspaceId = workspaceId,
            cloudSettings = cloudSettings,
            configuration = configuration,
            previousGuestMigration = cloudGuestSessionCoordinator.lastLocalGuestWorkspaceMigration
        )
    }

    @MainThread
    suspend fun deliver(
        request: AiImportRequest,
        handoff: (AiImport, AiImportTarget?) -> Boolean
    ): Unit = cloudOperationCoordinator.runExclusive {
        val workspaceId = workspaceRepository.observeWorkspace().first()?.workspaceId
        val target = workspaceId?.let {
            val settings = cloudPreferencesStore.currentCloudSettings()
            val configuration = cloudPreferencesStore.currentServerConfiguration()
            val current = resolveAiImportCloudSettings(
                workspaceId = workspaceId,
                settings = settings,
                configuration = configuration
            ) ?: return@let null
            val isSameIdentity = matchesOrigin(
                origin = request.origin,
                workspaceId = workspaceId,
                current = current,
                configuration = configuration
            )
            if (!isSameIdentity) {
                return@let null
            }
            // The AI destination retries when reconciliation restores the guest user ID.
            if (current.linkedUserId != settings.linkedUserId) {
                return@runExclusive
            }
            AiImportTarget(
                workspaceId = workspaceId,
                cloudState = current.cloudState,
                linkedUserId = current.linkedUserId,
                installationId = current.installationId,
                configuration = configuration
            )
        }

        if (appHandoffCoordinator.observeAiImport().value?.requestId != request.requestId) {
            return@runExclusive
        }
        if (handoff(request.aiImport, target)) {
            appHandoffCoordinator.consumeAiImport(requestId = request.requestId)
        }
    }

    private fun matchesOrigin(
        origin: AiImportOrigin,
        workspaceId: String,
        current: CloudSettings,
        configuration: CloudServiceConfiguration
    ): Boolean {
        if (origin.cloudSettings.installationId != current.installationId || origin.configuration != configuration) {
            return false
        }
        val isSameWorkspace = workspaceId == origin.workspaceId &&
            origin.cloudSettings.cloudState == current.cloudState &&
            origin.cloudSettings.linkedUserId == current.linkedUserId
        val migration = cloudGuestSessionCoordinator.lastLocalGuestWorkspaceMigration
        val isGuestMigration = origin.cloudSettings.cloudState == CloudAccountState.DISCONNECTED &&
            origin.cloudSettings.linkedUserId == null &&
            migration != null && migration !== origin.previousGuestMigration &&
            migration.sourceWorkspaceId == origin.workspaceId && migration.guestWorkspaceId == workspaceId &&
            (current.cloudState == CloudAccountState.DISCONNECTED && current.linkedUserId == null ||
                current.cloudState == CloudAccountState.GUEST && migration.guestUserId == current.linkedUserId)
        return isSameWorkspace || isGuestMigration
    }

    private suspend fun resolveAiImportCloudSettings(
        workspaceId: String,
        settings: CloudSettings,
        configuration: CloudServiceConfiguration
    ): CloudSettings? {
        if (settings.cloudState != CloudAccountState.GUEST || settings.linkedUserId != null) {
            return settings
        }
        if (cloudPreferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }

        val userId = try {
            withContext(Dispatchers.IO) {
                guestAiSessionStore.loadSession(localWorkspaceId = workspaceId, configuration = configuration)
                    ?.takeIf { session -> session.isAnalyticsOnly.not() && session.userId.isNotBlank() }
                    ?.userId
            }
        } catch (error: GuestAiSessionStorageException) {
            AiChatDiagnosticsLogger.error(
                event = "anki_import_guest_session_read_failed",
                fields = listOf("workspaceId" to workspaceId),
                throwable = error
            )
            null
        } ?: return null
        return settings.copy(linkedUserId = userId)
    }
}
