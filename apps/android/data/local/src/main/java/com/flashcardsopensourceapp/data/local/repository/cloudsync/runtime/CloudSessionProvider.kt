package com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator

internal data class AuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

internal class CloudSessionProvider(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator
) {
    suspend fun authenticatedSession(): AuthenticatedCloudSession {
        try {
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val storedCredentials: StoredCloudCredentials = requireNotNull(preferencesStore.loadCredentials()) {
                "Cloud account is not signed in."
            }

            val refreshedCredentials: StoredCloudCredentials = if (
                shouldRefreshCloudIdToken(
                    idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            ) {
                remoteService.refreshIdToken(
                    refreshToken = storedCredentials.refreshToken,
                    authBaseUrl = configuration.authBaseUrl
                ).also(preferencesStore::saveCredentials)
            } else {
                storedCredentials
            }
            val accountSnapshot: CloudAccountSnapshot = fetchCloudAccount(
                credentials = refreshedCredentials,
                configuration = configuration
            )

            return AuthenticatedCloudSession(
                configuration = configuration,
                credentials = refreshedCredentials,
                accountSnapshot = accountSnapshot
            )
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetLocalStateForDeletedAccount()
                throw IllegalStateException("Your account has already been deleted.")
            }
            throw error
        }
    }

    suspend fun authenticatedSession(linkContext: CloudWorkspaceLinkContext): AuthenticatedCloudSession {
        try {
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val refreshedCredentials: StoredCloudCredentials = if (
                shouldRefreshCloudIdToken(
                    idTokenExpiresAtMillis = linkContext.credentials.idTokenExpiresAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            ) {
                remoteService.refreshIdToken(
                    refreshToken = linkContext.credentials.refreshToken,
                    authBaseUrl = configuration.authBaseUrl
                )
            } else {
                linkContext.credentials
            }
            val accountSnapshot: CloudAccountSnapshot = fetchCloudAccount(
                credentials = refreshedCredentials,
                configuration = configuration
            )
            require(accountSnapshot.userId == linkContext.userId) {
                "Cloud account changed during workspace setup. Start sign-in again."
            }

            return AuthenticatedCloudSession(
                configuration = configuration,
                credentials = refreshedCredentials,
                accountSnapshot = accountSnapshot
            )
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetLocalStateForDeletedAccount()
                throw IllegalStateException("Your account has already been deleted.")
            }
            throw error
        }
    }

    suspend fun fetchCloudAccount(
        credentials: StoredCloudCredentials,
        configuration: CloudServiceConfiguration
    ): CloudAccountSnapshot {
        return remoteService.fetchCloudAccount(
            apiBaseUrl = configuration.apiBaseUrl,
            bearerToken = credentials.idToken
        )
    }

    private suspend fun resetLocalStateForDeletedAccount() {
        operationCoordinator.runExclusive {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }
}
