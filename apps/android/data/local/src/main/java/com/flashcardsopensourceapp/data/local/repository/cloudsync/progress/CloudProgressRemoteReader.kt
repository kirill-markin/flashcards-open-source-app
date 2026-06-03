package com.flashcardsopensourceapp.data.local.repository.cloudsync.progress

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider

internal class CloudProgressRemoteReader(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val sessionProvider: CloudSessionProvider
) {
    suspend fun loadProgressSeries(
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        return operationCoordinator.runExclusive {
            val progressSession: ProgressCloudSession = progressSession()
            remoteService.loadProgressSeries(
                apiBaseUrl = progressSession.apiBaseUrl,
                authorizationHeader = progressSession.authorizationHeader,
                timeZone = timeZone,
                from = from,
                to = to
            )
        }
    }

    suspend fun loadProgressSummary(timeZone: String): CloudProgressSummary {
        return operationCoordinator.runExclusive {
            val progressSession: ProgressCloudSession = progressSession()
            remoteService.loadProgressSummary(
                apiBaseUrl = progressSession.apiBaseUrl,
                authorizationHeader = progressSession.authorizationHeader,
                timeZone = timeZone,
            )
        }
    }

    suspend fun loadProgressReviewSchedule(timeZone: String): CloudProgressReviewSchedule {
        return operationCoordinator.runExclusive {
            val progressSession: ProgressCloudSession = progressSession()
            remoteService.loadProgressReviewSchedule(
                apiBaseUrl = progressSession.apiBaseUrl,
                authorizationHeader = progressSession.authorizationHeader,
                timeZone = timeZone
            )
        }
    }

    private suspend fun progressSession(): ProgressCloudSession {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
                ProgressCloudSession(
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
                    "Guest progress requires an active guest session."
                }
                ProgressCloudSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                )
            }

            else -> {
                throw IllegalStateException("Progress requires a linked or guest cloud account.")
            }
        }
    }
}

private data class ProgressCloudSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)
