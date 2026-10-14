package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal suspend fun loadActiveGuestSessionOrNull(
    preferencesStore: CloudPreferencesStore,
    guestSessionStore: GuestAiSessionStore,
    configuration: CloudServiceConfiguration
): StoredGuestAiSession? = withContext(Dispatchers.IO) {
    if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
        return@withContext null
    }

    val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
    val guestWorkspaceId: String? = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
    if (cloudSettings.cloudState == CloudAccountState.GUEST && guestWorkspaceId != null) {
        val activeWorkspaceSession: StoredGuestAiSession? = guestSessionStore.loadSession(
            localWorkspaceId = guestWorkspaceId,
            configuration = configuration
        )
        if (activeWorkspaceSession != null) {
            return@withContext activeWorkspaceSession
        }
    }

    guestSessionStore.loadAnySession(configuration = configuration)
}

/**
 * The one guest credential product analytics uses, resolved in a single place.
 *
 * Both the batches and the product-analytics answer have to travel on it: the server's ingest
 * backstop only looks at the identity a batch arrives under, so an answer parked on a different
 * stored session would never be consulted for the events actually being sent. That is why this is
 * deliberately not [loadActiveGuestSessionOrNull], which prefers the session bound to the active
 * cloud workspace: with more than one stored session the two pick different credentials.
 */
suspend fun loadProductAnalyticsGuestSessionOrNull(
    guestSessionStore: GuestAiSessionStore,
    configuration: CloudServiceConfiguration
): StoredGuestAiSession? = withContext(Dispatchers.IO) {
    guestSessionStore.loadAnySession(configuration = configuration)
}
