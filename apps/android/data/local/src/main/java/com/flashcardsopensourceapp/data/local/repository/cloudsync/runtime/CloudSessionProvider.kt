package com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.preservingLocalAccountIdentity
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal data class AuthenticatedCloudSession(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot
)

private data class RefreshedLinkCredentials(
    val linkContextCredentials: StoredCloudCredentials,
    val refreshedCredentials: StoredCloudCredentials
)

internal class CloudSessionProvider(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val resetCoordinator: CloudIdentityResetCoordinator
) {
    /**
     * The newest credential refreshed from a link context's credential. The context is immutable
     * and a retry after a failed link resends it, while a rotated refresh token has already spent
     * the one it holds; nothing persists the refreshed credential until the link succeeds.
     * Accessed only under the cloud operation lock.
     */
    private var refreshedLinkCredentials: RefreshedLinkCredentials? = null

    suspend fun authenticatedSession(): AuthenticatedCloudSession = operationCoordinator.runExclusive {
        try {
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val storedCredentials: StoredCloudCredentials = requireNotNull(
                withContext(Dispatchers.IO) { preferencesStore.loadCredentials() }
            ) {
                "Cloud account is not signed in."
            }

            val refreshedCredentials: StoredCloudCredentials = if (
                shouldRefreshCloudIdToken(
                    idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            ) {
                // Once the refresh spends the stored token, a cancelled caller must not drop the rotated one.
                withContext(NonCancellable) {
                    remoteService.refreshIdToken(
                        refreshToken = storedCredentials.refreshToken,
                        authBaseUrl = configuration.authBaseUrl
                    ).also { credentials ->
                        withContext(Dispatchers.IO) {
                            preferencesStore.saveCredentials(credentials)
                        }
                    }
                }
            } else {
                storedCredentials
            }
            val accountSnapshot: CloudAccountSnapshot = fetchCloudAccount(
                credentials = refreshedCredentials,
                configuration = configuration
            )
            requireFetchedAccountMatchesActiveLinkedIdentity(accountSnapshot = accountSnapshot)
            preferencesStore.saveAccountPreferences(preferences = accountSnapshot.preferences)

            AuthenticatedCloudSession(
                configuration = configuration,
                credentials = refreshedCredentials,
                accountSnapshot = accountSnapshot
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isRemoteAccountDeletedError(error = error)) {
                resetLocalStateForDeletedAccount()
                throw IllegalStateException("Your account has already been deleted.")
            }
            throw error
        }
    }

    suspend fun authenticatedSession(linkContext: CloudWorkspaceLinkContext): AuthenticatedCloudSession {
        operationCoordinator.requireExclusiveOperation(operationName = "Workspace link session")
        try {
            val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
            val linkCredentials: StoredCloudCredentials = refreshedLinkCredentials
                ?.takeIf { carried -> carried.linkContextCredentials == linkContext.credentials }
                ?.refreshedCredentials
                ?: linkContext.credentials
            val refreshedCredentials: StoredCloudCredentials = if (
                shouldRefreshCloudIdToken(
                    idTokenExpiresAtMillis = linkCredentials.idTokenExpiresAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            ) {
                // Once the refresh spends the carried token, a cancelled caller must not drop the rotated one.
                withContext(NonCancellable) {
                    remoteService.refreshIdToken(
                        refreshToken = linkCredentials.refreshToken,
                        authBaseUrl = configuration.authBaseUrl
                    ).also { credentials ->
                        refreshedLinkCredentials = RefreshedLinkCredentials(
                            linkContextCredentials = linkContext.credentials,
                            refreshedCredentials = credentials
                        )
                    }
                }
            } else {
                linkCredentials
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
        } catch (error: CancellationException) {
            throw error
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
            authorizationHeader = "Bearer ${credentials.idToken}"
        ).preservingLocalAccountIdentity(
            settings = preferencesStore.currentCloudSettings()
        )
    }

    private suspend fun resetLocalStateForDeletedAccount() {
        operationCoordinator.runExclusive {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
    }

    private suspend fun requireFetchedAccountMatchesActiveLinkedIdentity(accountSnapshot: CloudAccountSnapshot) {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            return
        }

        val expectedUserId: String = cloudSettings.linkedUserId?.trim()?.ifEmpty { null } ?: return
        if (expectedUserId == accountSnapshot.userId) {
            return
        }

        operationCoordinator.runExclusive {
            resetCoordinator.resetLocalStateForCloudIdentityChange()
        }
        throw IllegalStateException(
            "Cloud account changed during authenticated session refresh. Local cloud identity was reset; sign in again."
        )
    }
}
