package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator

/**
 * Supplies the guest credential product analytics authenticates with on an install that has never
 * signed in.
 *
 * Deliberately not [CloudGuestSessionCoordinator.ensureGuestCloudSession]: that path migrates the
 * local shell workspace and sets `CloudAccountState.GUEST`, which `LocalSyncRepository` reads as
 * cloud sync being enabled. Nothing here touches cloud state, workspaces or sync.
 *
 * Creation itself goes through the shared [GuestCloudSessionCreationCoordinator] the cloud guest
 * restore uses, which is what keeps an install to exactly one guest identity when both paths run at
 * once. The session is stored unbound to a local workspace and marked analytics-only, so a later
 * opt-in to AI chat, feedback or cloud sync adopts this identity instead of minting a second one,
 * and sign-in claims it through `/guest-auth/identity/link` rather than the upgrade flow.
 */
class AnalyticsGuestSessionMinter(
    private val preferencesStore: CloudPreferencesStore,
    private val creationCoordinator: GuestCloudSessionCreationCoordinator,
    private val operationCoordinator: CloudOperationCoordinator
) {
    /** Returns the stored session when one already exists, so an install holds exactly one guest. */
    suspend fun mintAnalyticsGuestSession(): StoredGuestAiSession = operationCoordinator.runExclusive {
        check(preferencesStore.loadCloudCredentialRecoveryState() == null) {
            "Analytics guest creation is unavailable during cloud credential recovery."
        }
        val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
        creationCoordinator.loadOrCreateGuestCloudSession(
            configuration = configuration,
            isAnalyticsOnly = true
        )
    }
}
