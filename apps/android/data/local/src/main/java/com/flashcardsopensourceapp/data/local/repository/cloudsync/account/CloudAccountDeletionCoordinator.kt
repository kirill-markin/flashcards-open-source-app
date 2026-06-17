package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.resumePendingGuestUpgradeRecoveryIfNeeded
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.isRemoteAccountDeletedError
import kotlinx.coroutines.CancellationException

private const val accountDeletionConfirmationTextForCloudApi: String = "delete my account"

internal class CloudAccountDeletionCoordinator(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val syncLocalStore: SyncLocalStore,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val sessionProvider: CloudSessionProvider,
    private val appVersion: String
) {
    private var isAccountDeletionRunning: Boolean = false

    suspend fun beginAccountDeletion() {
        operationCoordinator.runExclusive {
            preferencesStore.markAccountDeletionInProgress()
            runAccountDeletion()
        }
    }

    suspend fun resumePendingAccountDeletionIfNeeded() {
        operationCoordinator.runExclusive {
            resumePendingGuestUpgradeIfNeeded()
            if (preferencesStore.currentAccountDeletionState() == AccountDeletionState.Hidden) {
                return@runExclusive
            }
            runAccountDeletion()
        }
    }

    suspend fun retryPendingAccountDeletion() {
        operationCoordinator.runExclusive {
            preferencesStore.markAccountDeletionInProgress()
            runAccountDeletion()
        }
    }

    suspend fun deleteAccount(confirmationText: String) {
        operationCoordinator.runExclusive {
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            try {
                remoteService.deleteAccount(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    confirmationText = confirmationText
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (isRemoteAccountDeletedError(error = error)) {
                    resetCoordinator.resetLocalStateForCloudIdentityChange()
                    return@runExclusive
                }
                throw error
            }
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    private suspend fun runAccountDeletion() {
        if (isAccountDeletionRunning) {
            return
        }

        isAccountDeletionRunning = true
        try {
            val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
            try {
                remoteService.deleteAccount(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    bearerToken = authenticatedSession.credentials.idToken,
                    confirmationText = accountDeletionConfirmationTextForCloudApi
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (isRemoteAccountDeletedError(error = error).not()) {
                    preferencesStore.markAccountDeletionFailed(
                        message = error.message ?: "Account deletion failed."
                    )
                    return
                }
            }
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetCoordinator.resetLocalStateForCloudIdentityChange()
                return
            }
            preferencesStore.markAccountDeletionFailed(
                message = error.message ?: "Account deletion failed."
            )
        } finally {
            isAccountDeletionRunning = false
        }
    }

    private suspend fun resumePendingGuestUpgradeIfNeeded() {
        resumePendingGuestUpgradeRecoveryIfNeeded(
            database = database,
            preferencesStore = preferencesStore,
            remoteService = remoteService,
            syncLocalStore = syncLocalStore,
            guestSessionStore = guestSessionStore,
            appVersion = appVersion
        )
    }
}
