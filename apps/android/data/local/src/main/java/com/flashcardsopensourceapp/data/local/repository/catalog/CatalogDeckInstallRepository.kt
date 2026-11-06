package com.flashcardsopensourceapp.data.local.repository.catalog

import android.util.Log
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.remote.catalog.CatalogPackageInstallRequest
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckUnavailableException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.refreshExpiredStoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.buildClientWorkspaceReplicaId
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.requireCurrentWorkspace
import java.util.UUID

private const val catalogDeckInstallLogTag: String = "CatalogDeckInstall"

interface CatalogDeckInstallRepository {
    /**
     * Installs the deck's package version into the current workspace unless that workspace already
     * holds an install of the package, then waits for a sync so its cards are local. A device with
     * no cloud session gets a guest one. Throws [CatalogDeckUnavailableException] when the server no
     * longer publishes the version.
     */
    suspend fun installDeckIntoCurrentWorkspace(deck: CatalogBrowseIndexDeck)
}

private data class CatalogInstallSession(
    val apiBaseUrl: String,
    val authorizationHeader: String,
    val workspaceId: String
)

class CloudCatalogDeckInstallRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteService,
    private val cloudGuestSessionCoordinator: CloudGuestSessionCoordinator,
    private val operationCoordinator: CloudOperationCoordinator,
    private val syncRepository: SyncRepository
) : CatalogDeckInstallRepository {
    override suspend fun installDeckIntoCurrentWorkspace(deck: CatalogBrowseIndexDeck) {
        val session = cloudSession()
        try {
            val workspaces = remoteService.loadCatalogPackageInstallContext(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                packageVersionId = deck.packageVersionId
            )
            val workspace = requireNotNull(workspaces.firstOrNull { candidate -> candidate.workspaceId == session.workspaceId }) {
                "Catalog install context does not list the current workspace: workspaceId=${session.workspaceId} " +
                    "packageVersionId=${deck.packageVersionId} listedWorkspaceIds=${workspaces.map { candidate -> candidate.workspaceId }}"
            }
            if (workspace.previousInstallId == null) {
                val installId = UUID.randomUUID().toString().lowercase()
                val now = formatIsoTimestamp(timestampMillis = System.currentTimeMillis())
                remoteService.installCatalogPackageVersion(
                    apiBaseUrl = session.apiBaseUrl,
                    authorizationHeader = session.authorizationHeader,
                    workspaceId = session.workspaceId,
                    packageVersionId = deck.packageVersionId,
                    request = CatalogPackageInstallRequest(
                        installId = installId,
                        installedAt = now,
                        clientUpdatedAt = now,
                        lastModifiedByReplicaId = buildClientWorkspaceReplicaId(
                            workspaceId = session.workspaceId,
                            installationId = preferencesStore.currentCloudSettings().installationId
                        )
                    )
                )
                Log.i(
                    catalogDeckInstallLogTag,
                    "event=catalog_deck_installed packageVersionId=${deck.packageVersionId} " +
                        "workspaceId=${session.workspaceId} installId=$installId"
                )
            } else {
                Log.i(
                    catalogDeckInstallLogTag,
                    "event=catalog_deck_install_skipped packageVersionId=${deck.packageVersionId} " +
                        "workspaceId=${session.workspaceId} previousInstallId=${workspace.previousInstallId}"
                )
            }
        } catch (error: CloudRemoteException) {
            throw catalogDeckUnavailableOrSelf(error = error, deck = deck)
        }
        syncRepository.syncNow()
    }

    /** Linked and guest sessions as they are; a disconnected or linking-ready device becomes a guest. */
    private suspend fun cloudSession(): CatalogInstallSession {
        val reconciliation = cloudGuestSessionCoordinator.reconcilePersistedCloudState()
        val configuration = preferencesStore.currentServerConfiguration()
        if (reconciliation.cloudSettings.cloudState == CloudAccountState.LINKED) {
            val credentials = refreshExpiredStoredCloudCredentials(
                storedCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                    "Cloud account is not signed in."
                },
                authBaseUrl = configuration.authBaseUrl,
                preferencesStore = preferencesStore,
                remoteService = remoteService,
                operationCoordinator = operationCoordinator
            )
            return CatalogInstallSession(
                apiBaseUrl = configuration.apiBaseUrl,
                authorizationHeader = "Bearer ${credentials.idToken}",
                workspaceId = requireCurrentWorkspace(
                    database = database,
                    preferencesStore = preferencesStore,
                    missingWorkspaceMessage = "Catalog deck install requires a current local workspace."
                ).workspaceId
            )
        }

        val guestSession = cloudGuestSessionCoordinator.restoreGuestCloudSessionIfNeeded(
            workspaceId = requireCurrentWorkspace(
                database = database,
                preferencesStore = preferencesStore,
                missingWorkspaceMessage = "Catalog deck install requires a current local workspace."
            ).workspaceId,
            createSessionIfMissing = true
        )
        // A new guest workspace registers this installation's replica on its first sync, and the
        // install names that replica.
        if (guestSession.shouldSync) {
            syncRepository.syncNow()
        }
        return CatalogInstallSession(
            apiBaseUrl = guestSession.session.apiBaseUrl,
            authorizationHeader = "Guest ${guestSession.session.guestToken}",
            workspaceId = guestSession.session.workspaceId
        )
    }
}
