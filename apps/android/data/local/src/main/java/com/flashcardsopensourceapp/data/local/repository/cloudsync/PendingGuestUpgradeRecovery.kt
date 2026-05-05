package com.flashcardsopensourceapp.data.local.repository.cloudsync

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.PendingGuestUpgradeState
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.shouldRefreshCloudIdToken
import kotlinx.coroutines.CancellationException

internal suspend fun resumePendingGuestUpgradeRecoveryIfNeeded(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    guestSessionStore: GuestAiSessionStore,
    appVersion: String
): CloudWorkspaceSummary? {
    val pendingGuestUpgradeState: PendingGuestUpgradeState =
        preferencesStore.loadPendingGuestUpgrade() ?: return null
    val refreshedGuestUpgradeState: PendingGuestUpgradeState = refreshPendingGuestUpgradeCredentialsIfNeeded(
        pendingGuestUpgradeState = pendingGuestUpgradeState,
        preferencesStore = preferencesStore,
        remoteService = remoteService
    )
    return finalizePendingGuestUpgradeRecovery(
        database = database,
        preferencesStore = preferencesStore,
        syncLocalStore = syncLocalStore,
        guestSessionStore = guestSessionStore,
        remoteService = remoteService,
        pendingGuestUpgradeState = refreshedGuestUpgradeState,
        appVersion = appVersion
    )
}

private suspend fun refreshPendingGuestUpgradeCredentialsIfNeeded(
    pendingGuestUpgradeState: PendingGuestUpgradeState,
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway
): PendingGuestUpgradeState {
    if (
        shouldRefreshCloudIdToken(
            idTokenExpiresAtMillis = pendingGuestUpgradeState.credentials.idTokenExpiresAtMillis,
            nowMillis = System.currentTimeMillis()
        ).not()
    ) {
        return pendingGuestUpgradeState
    }

    val refreshedCredentials: StoredCloudCredentials = remoteService.refreshIdToken(
        refreshToken = pendingGuestUpgradeState.credentials.refreshToken,
        authBaseUrl = pendingGuestUpgradeState.configuration.authBaseUrl
    )
    val refreshedAccountSnapshot: CloudAccountSnapshot = fetchCloudAccount(
        credentials = refreshedCredentials,
        configuration = pendingGuestUpgradeState.configuration,
        remoteService = remoteService
    )
    require(refreshedAccountSnapshot.userId == pendingGuestUpgradeState.accountSnapshot.userId) {
        "Cloud account changed during pending guest upgrade recovery. Start sign-in again."
    }
    val refreshedGuestUpgradeState: PendingGuestUpgradeState = pendingGuestUpgradeState.copy(
        credentials = refreshedCredentials,
        accountSnapshot = refreshedAccountSnapshot
    )
    preferencesStore.savePendingGuestUpgrade(pendingGuestUpgradeState = refreshedGuestUpgradeState)
    return refreshedGuestUpgradeState
}

private suspend fun fetchCloudAccount(
    credentials: StoredCloudCredentials,
    configuration: CloudServiceConfiguration,
    remoteService: CloudRemoteGateway
): CloudAccountSnapshot {
    return remoteService.fetchCloudAccount(
        apiBaseUrl = configuration.apiBaseUrl,
        bearerToken = credentials.idToken
    )
}

/**
 * Pending guest upgrade state is written after guest sync has drained but
 * before backend completion. Recovery can replay backend completion and never
 * carries guest outbox rows into the linked workspace.
 */
private suspend fun finalizePendingGuestUpgradeRecovery(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    syncLocalStore: SyncLocalStore,
    guestSessionStore: GuestAiSessionStore,
    remoteService: CloudRemoteGateway,
    pendingGuestUpgradeState: PendingGuestUpgradeState,
    appVersion: String
): CloudWorkspaceSummary {
    val completion: CloudGuestUpgradeCompletion = completePendingGuestUpgradeIfNeeded(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        pendingGuestUpgradeState = pendingGuestUpgradeState
    )
    applyPendingGuestUpgradeLinkedWorkspace(
        database = database,
        preferencesStore = preferencesStore,
        syncLocalStore = syncLocalStore,
        pendingGuestUpgradeState = pendingGuestUpgradeState,
        completion = completion
    )
    preferencesStore.saveCredentials(pendingGuestUpgradeState.credentials)
    requireNoPendingGuestUpgradeOutbox(
        syncLocalStore = syncLocalStore,
        workspaceId = completion.workspace.workspaceId
    )
    hydratePendingGuestUpgradeLinkedWorkspace(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        syncLocalStore = syncLocalStore,
        pendingGuestUpgradeState = pendingGuestUpgradeState,
        completion = completion,
        appVersion = appVersion
    )
    guestSessionStore.clearAllSessions()
    preferencesStore.clearPendingGuestUpgrade()
    return completion.workspace
}

private suspend fun completePendingGuestUpgradeIfNeeded(
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    pendingGuestUpgradeState: PendingGuestUpgradeState
): CloudGuestUpgradeCompletion {
    val savedCompletion: CloudGuestUpgradeCompletion? = pendingGuestUpgradeState.completion
    if (savedCompletion != null) {
        return savedCompletion
    }

    val completion: CloudGuestUpgradeCompletion = remoteService.completeGuestUpgrade(
        apiBaseUrl = pendingGuestUpgradeState.configuration.apiBaseUrl,
        bearerToken = pendingGuestUpgradeState.credentials.idToken,
        guestToken = pendingGuestUpgradeState.guestSession.guestToken,
        selection = pendingGuestUpgradeState.selection.toGuestUpgradeSelection(),
        guestWorkspaceSyncedAndOutboxDrained = true,
        supportsDroppedEntities = pendingGuestUpgradeState.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED
    )
    preferencesStore.savePendingGuestUpgrade(
        pendingGuestUpgradeState = pendingGuestUpgradeState.copy(completion = completion)
    )
    return completion
}

private suspend fun requireNoPendingGuestUpgradeOutbox(
    syncLocalStore: SyncLocalStore,
    workspaceId: String
) {
    val pendingOutboxCount: Int = syncLocalStore.countOutboxEntries(workspaceId = workspaceId)
    require(pendingOutboxCount == 0) {
        "Pending guest upgrade recovery cannot continue because linked workspace '$workspaceId' has " +
            "$pendingOutboxCount local outbox operation(s). Restart the app before making more local changes."
    }
}

private suspend fun hydratePendingGuestUpgradeLinkedWorkspace(
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    syncLocalStore: SyncLocalStore,
    pendingGuestUpgradeState: PendingGuestUpgradeState,
    completion: CloudGuestUpgradeCompletion,
    appVersion: String
) {
    try {
        runCloudSyncCore(
            cloudSettings = preferencesStore.currentCloudSettings(),
            workspaceId = completion.workspace.workspaceId,
            syncSession = CloudSyncSession(
                apiBaseUrl = pendingGuestUpgradeState.configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${pendingGuestUpgradeState.credentials.idToken}"
            ),
            appVersion = appVersion,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            workspaceForkRecoveryMode = CloudWorkspaceForkRecoveryMode.ENABLED
        )
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        val preservesBlockedSyncState = error is CloudSyncBlockedException || isCloudIdentityConflictError(error = error)
        if (preservesBlockedSyncState.not()) {
            syncLocalStore.markSyncFailure(
                workspaceId = completion.workspace.workspaceId,
                errorMessage = error.message ?: "Cloud sync failed."
            )
        }
        throw IllegalStateException(
            "Guest upgrade completed on the server, but Android could not hydrate linked workspace " +
                "'${completion.workspace.workspaceId}'. Check your connection and reopen the app to retry. " +
                "Cause=${error.message ?: "Cloud sync failed."}",
            error
        )
    }
}

private suspend fun applyPendingGuestUpgradeLinkedWorkspace(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    syncLocalStore: SyncLocalStore,
    pendingGuestUpgradeState: PendingGuestUpgradeState,
    completion: CloudGuestUpgradeCompletion
) {
    when (pendingGuestUpgradeState.guestUpgradeMode) {
        CloudGuestUpgradeMode.BOUND -> applyBoundGuestUpgradeLinkedWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            syncLocalStore = syncLocalStore,
            accountSnapshot = pendingGuestUpgradeState.accountSnapshot,
            selectedWorkspace = completion.workspace
        )

        CloudGuestUpgradeMode.MERGE_REQUIRED -> applyDrainedMergeGuestUpgradeLinkedWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            syncLocalStore = syncLocalStore,
            accountSnapshot = pendingGuestUpgradeState.accountSnapshot,
            selectedWorkspace = completion.workspace
        )
    }
}

private suspend fun applyBoundGuestUpgradeLinkedWorkspace(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    syncLocalStore: SyncLocalStore,
    accountSnapshot: CloudAccountSnapshot,
    selectedWorkspace: CloudWorkspaceSummary
) {
    val localLinkedWorkspace: WorkspaceEntity = syncLocalStore.bindGuestUpgradeToLinkedWorkspace(
        workspace = selectedWorkspace
    )
    finalizeGuestUpgradeLinkedWorkspaceMigration(
        database = database,
        preferencesStore = preferencesStore,
        accountSnapshot = accountSnapshot,
        selectedWorkspace = selectedWorkspace,
        localLinkedWorkspace = localLinkedWorkspace,
        missingWorkspaceMessage = "Linked workspace is missing locally after bound guest upgrade."
    )
}

/**
 * Merge-required upgrade drains guest sync before backend completion, so local
 * finalization discards the guest shell/outbox and hydrates the linked
 * workspace from remote cloud state already merged by the backend.
 */
private suspend fun applyDrainedMergeGuestUpgradeLinkedWorkspace(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    syncLocalStore: SyncLocalStore,
    accountSnapshot: CloudAccountSnapshot,
    selectedWorkspace: CloudWorkspaceSummary
) {
    val localLinkedWorkspace: WorkspaceEntity = loadAlreadyAppliedLinkedWorkspaceShellOrNull(
        database = database,
        selectedWorkspace = selectedWorkspace
    ) ?: syncLocalStore.migrateLocalShellToLinkedWorkspace(
        workspace = selectedWorkspace,
        remoteWorkspaceIsEmpty = false
    )
    finalizeGuestUpgradeLinkedWorkspaceMigration(
        database = database,
        preferencesStore = preferencesStore,
        accountSnapshot = accountSnapshot,
        selectedWorkspace = selectedWorkspace,
        localLinkedWorkspace = localLinkedWorkspace,
        missingWorkspaceMessage = "Linked workspace is missing locally after guest upgrade."
    )
}

private suspend fun loadAlreadyAppliedLinkedWorkspaceShellOrNull(
    database: AppDatabase,
    selectedWorkspace: CloudWorkspaceSummary
): WorkspaceEntity? {
    val localWorkspaces: List<WorkspaceEntity> = database.workspaceDao().loadWorkspaces()
    if (localWorkspaces.size != 1) {
        return null
    }

    val localWorkspace: WorkspaceEntity = localWorkspaces.single()
    if (localWorkspace.workspaceId != selectedWorkspace.workspaceId) {
        return null
    }

    val refreshedWorkspace: WorkspaceEntity = localWorkspace.copy(
        name = selectedWorkspace.name,
        createdAtMillis = selectedWorkspace.createdAtMillis
    )
    database.workspaceDao().updateWorkspace(workspace = refreshedWorkspace)
    return refreshedWorkspace
}

private suspend fun finalizeGuestUpgradeLinkedWorkspaceMigration(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    accountSnapshot: CloudAccountSnapshot,
    selectedWorkspace: CloudWorkspaceSummary,
    localLinkedWorkspace: WorkspaceEntity,
    missingWorkspaceMessage: String
) {
    check(localLinkedWorkspace.workspaceId == selectedWorkspace.workspaceId) {
        "Linked workspace migration produced an unexpected local workspace. " +
            "Expected='${selectedWorkspace.workspaceId}' Actual='${localLinkedWorkspace.workspaceId}'."
    }

    preferencesStore.updateCloudSettings(
        cloudState = CloudAccountState.LINKED,
        linkedUserId = accountSnapshot.userId,
        linkedWorkspaceId = selectedWorkspace.workspaceId,
        linkedEmail = accountSnapshot.email,
        activeWorkspaceId = selectedWorkspace.workspaceId
    )
    val localCurrentWorkspace: WorkspaceEntity = requireCurrentWorkspace(
        database = database,
        preferencesStore = preferencesStore,
        missingWorkspaceMessage = missingWorkspaceMessage
    )
    check(localCurrentWorkspace.workspaceId == selectedWorkspace.workspaceId) {
        "Linked workspace '${selectedWorkspace.workspaceId}' did not become the current local workspace. " +
            "Local workspace='${localCurrentWorkspace.workspaceId}'."
    }
    requireGuestUpgradeTransitionInvariant(
        database = database,
        preferencesStore = preferencesStore,
        expectedWorkspaceId = selectedWorkspace.workspaceId
    )
}

private suspend fun requireGuestUpgradeTransitionInvariant(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    expectedWorkspaceId: String
) {
    val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
    val localWorkspaceIds: List<String> = database.workspaceDao()
        .loadWorkspaces()
        .map(WorkspaceEntity::workspaceId)
    require(localWorkspaceIds.size == 1) {
        buildGuestUpgradeTransitionInvariantMessage(
            expectedWorkspaceId = expectedWorkspaceId,
            localWorkspaceIds = localWorkspaceIds,
            cloudSettings = cloudSettings
        )
    }
    require(localWorkspaceIds.single() == expectedWorkspaceId) {
        buildGuestUpgradeTransitionInvariantMessage(
            expectedWorkspaceId = expectedWorkspaceId,
            localWorkspaceIds = localWorkspaceIds,
            cloudSettings = cloudSettings
        )
    }
    require(cloudSettings.linkedWorkspaceId == expectedWorkspaceId) {
        buildGuestUpgradeTransitionInvariantMessage(
            expectedWorkspaceId = expectedWorkspaceId,
            localWorkspaceIds = localWorkspaceIds,
            cloudSettings = cloudSettings
        )
    }
    require(cloudSettings.activeWorkspaceId == expectedWorkspaceId) {
        buildGuestUpgradeTransitionInvariantMessage(
            expectedWorkspaceId = expectedWorkspaceId,
            localWorkspaceIds = localWorkspaceIds,
            cloudSettings = cloudSettings
        )
    }
}

private fun buildGuestUpgradeTransitionInvariantMessage(
    expectedWorkspaceId: String,
    localWorkspaceIds: List<String>,
    cloudSettings: CloudSettings
): String {
    return "Pending guest upgrade recovery invariant failed. " +
        "expectedWorkspaceId='$expectedWorkspaceId' " +
        "activeWorkspaceId='${cloudSettings.activeWorkspaceId}' " +
        "linkedWorkspaceId='${cloudSettings.linkedWorkspaceId}' " +
        "localWorkspaceIds=$localWorkspaceIds"
}
