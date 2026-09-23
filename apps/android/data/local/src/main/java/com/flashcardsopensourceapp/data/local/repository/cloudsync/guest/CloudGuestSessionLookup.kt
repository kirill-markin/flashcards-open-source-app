package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession

internal fun loadActiveGuestSessionOrNull(
    preferencesStore: CloudPreferencesStore,
    guestSessionStore: GuestAiSessionStore,
    configuration: CloudServiceConfiguration
): StoredGuestAiSession? {
    if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
        return null
    }

    val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
    val guestWorkspaceId: String? = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
    if (cloudSettings.cloudState == CloudAccountState.GUEST && guestWorkspaceId != null) {
        val activeWorkspaceSession: StoredGuestAiSession? = guestSessionStore.loadSession(
            localWorkspaceId = guestWorkspaceId,
            configuration = configuration
        )
        if (activeWorkspaceSession != null) {
            return activeWorkspaceSession
        }
    }

    return guestSessionStore.loadAnySession(configuration = configuration)
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
fun loadProductAnalyticsGuestSessionOrNull(
    guestSessionStore: GuestAiSessionStore,
    configuration: CloudServiceConfiguration
): StoredGuestAiSession? {
    return guestSessionStore.loadAnySession(configuration = configuration)
}
