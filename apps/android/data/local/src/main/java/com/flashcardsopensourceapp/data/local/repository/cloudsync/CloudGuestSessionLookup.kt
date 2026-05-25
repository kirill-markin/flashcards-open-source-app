package com.flashcardsopensourceapp.data.local.repository.cloudsync

import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession

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
