package com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/**
 * The stored credential, refreshed only when its id token has expired.
 *
 * The refreshed credential is persisted, because a rotated refresh token invalidates the stored
 * one, but only under the cloud operation lock and only over the credential this refresh started
 * from: the refresh itself may run without the lock, so a concurrent logout or sign-in must win.
 * Refresh and save are non-cancellable: once the refresh spends the stored token, a cancelled
 * caller must not drop the rotated one.
 */
internal suspend fun refreshExpiredStoredCloudCredentials(
    storedCredentials: StoredCloudCredentials,
    authBaseUrl: String,
    preferencesStore: CloudPreferencesStore,
    remoteService: CloudRemoteGateway,
    operationCoordinator: CloudOperationCoordinator
): StoredCloudCredentials {
    if (
        shouldRefreshCloudIdToken(
            idTokenExpiresAtMillis = storedCredentials.idTokenExpiresAtMillis,
            nowMillis = System.currentTimeMillis()
        ).not()
    ) {
        return storedCredentials
    }

    return withContext(NonCancellable) {
        val refreshedCredentials: StoredCloudCredentials = remoteService.refreshIdToken(
            refreshToken = storedCredentials.refreshToken,
            authBaseUrl = authBaseUrl
        )
        operationCoordinator.runExclusive {
            withContext(Dispatchers.IO) {
                if (preferencesStore.loadCredentials() == storedCredentials) {
                    preferencesStore.saveCredentials(refreshedCredentials)
                }
            }
        }
        refreshedCredentials
    }
}
