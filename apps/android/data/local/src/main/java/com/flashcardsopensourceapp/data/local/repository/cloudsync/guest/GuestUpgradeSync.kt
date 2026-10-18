package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isCloudIdentityConflictError
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudSyncSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.CloudWorkspaceForkRecoveryMode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runCloudSyncCore
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.syncBlockedExceptionFor
import kotlinx.coroutines.CancellationException

internal suspend fun drainGuestWorkspaceBeforeUpgrade(
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    appVersion: String,
    configuration: CloudServiceConfiguration,
    guestSession: StoredGuestAiSession
) {
    val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
    val guestWorkspaceId: String = requireNotNull(cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId) {
        "Guest upgrade requires an active guest workspace."
    }
    require(cloudSettings.cloudState == CloudAccountState.GUEST) {
        "Guest upgrade requires guest cloud state before completion."
    }
    require(guestWorkspaceId == guestSession.workspaceId) {
        "Guest upgrade requires current guest workspace '$guestWorkspaceId' to match stored guest session " +
            "'${guestSession.workspaceId}'. Restart the app and try signing in again."
    }

    try {
        runCloudSyncCore(
            cloudSettings = cloudSettings,
            workspaceId = guestWorkspaceId,
            syncSession = CloudSyncSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Guest ${guestSession.guestToken}"
            ),
            appVersion = appVersion,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            workspaceForkRecoveryMode = CloudWorkspaceForkRecoveryMode.DISABLED
        )
    } catch (error: CancellationException) {
        throw error
    } catch (error: SyncBlockedException) {
        throw error
    } catch (error: Exception) {
        if (isCloudIdentityConflictError(error = error)) {
            throw syncBlockedExceptionFor(error = error)
        }
        syncLocalStore.markSyncFailure(
            workspaceId = guestWorkspaceId,
            errorMessage = error.message ?: "Cloud sync failed."
        )
        throw IllegalStateException(
            "Guest upgrade is paused because guest sync did not finish for workspace '$guestWorkspaceId'. " +
                "Check your connection and try signing in again. Cause=${error.message ?: "Cloud sync failed."}",
            error
        )
    }

    val remainingOutboxCount: Int = syncLocalStore.countOutboxEntries(workspaceId = guestWorkspaceId)
    if (remainingOutboxCount > 0) {
        val message: String = "Guest upgrade is paused because guest workspace '$guestWorkspaceId' still has " +
            "$remainingOutboxCount pending local sync operation(s). Sync again before signing in."
        syncLocalStore.markSyncFailure(
            workspaceId = guestWorkspaceId,
            errorMessage = message
        )
        throw IllegalStateException(message)
    }
}

