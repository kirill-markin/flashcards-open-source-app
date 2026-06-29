package com.flashcardsopensourceapp.data.local.repository.review

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider

interface ReviewMediaAssetDownloadUrlLoader {
    suspend fun loadMediaAssetDownloadUrl(workspaceId: String, mediaAssetId: String): MediaAssetDownloadUrl
}

class CloudReviewMediaAssetDownloadUrlLoader(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    resetCoordinator: CloudIdentityResetCoordinator
) : ReviewMediaAssetDownloadUrlLoader {
    private val sessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )

    override suspend fun loadMediaAssetDownloadUrl(
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        return operationCoordinator.runExclusive {
            val session = reviewMediaCloudSession(workspaceId = workspaceId)
            remoteService.loadMediaAssetDownloadUrl(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId
            )
        }
    }

    private suspend fun reviewMediaCloudSession(workspaceId: String): ReviewMediaCloudSession {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val activeWorkspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
        require(activeWorkspaceId == workspaceId) {
            "Managed media download requires active workspace '$workspaceId', " +
                "but cloud settings point to '$activeWorkspaceId'."
        }

        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
                ReviewMediaCloudSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                )
            }

            CloudAccountState.GUEST -> {
                val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
                val guestSession: StoredGuestAiSession = requireNotNull(
                    loadActiveGuestSessionOrNull(
                        preferencesStore = preferencesStore,
                        guestSessionStore = guestSessionStore,
                        configuration = configuration
                    )
                ) {
                    "Managed media download requires an active guest session."
                }
                require(guestSession.workspaceId == workspaceId) {
                    "Managed media download requires guest workspace '$workspaceId', " +
                        "but the stored guest session points to '${guestSession.workspaceId}'."
                }
                ReviewMediaCloudSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                )
            }

            CloudAccountState.DISCONNECTED,
            CloudAccountState.LINKING_READY -> throw IllegalStateException(
                "Managed media download requires a linked or guest cloud account."
            )
        }
    }
}

private data class ReviewMediaCloudSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)
