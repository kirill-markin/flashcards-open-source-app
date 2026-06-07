package com.flashcardsopensourceapp.data.local.repository.cloudsync.account

import com.flashcardsopensourceapp.data.local.ai.store.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.store.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class CloudIdentityResetCoordinator(
    private val database: AppDatabase,
    private val cloudPreferencesStore: CloudPreferencesStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore,
    private val aiChatHistoryStore: AiChatHistoryStore,
    private val guestAiSessionStore: GuestAiSessionStore,
    private val onCloudIdentityReset: suspend () -> Unit = {}
) {
    private val resetMutex = Mutex()

    /**
     * Clears every persisted account-scoped identity boundary.
     *
     * This reset is intentionally stronger than a normal disconnect: logout and
     * account deletion must produce a fresh local installation id and remove any
     * stored guest session so the next guest restore starts from a brand new
     * guest user/workspace on the server instead of reusing a pre-reset guest
     * identity when linking to another account later.
     */
    suspend fun resetLocalStateForCloudIdentityChange() {
        withContext(Dispatchers.IO) {
            resetMutex.withLock {
                cloudPreferencesStore.clearCredentials()
                cloudPreferencesStore.clearCloudCredentialRecoveryState()
                cloudPreferencesStore.clearAccountPreferences()
                aiChatPreferencesStore.clearConsent()
                aiChatHistoryStore.clearAllState()
                guestAiSessionStore.clearAllSessions()
                onCloudIdentityReset()
                database.clearAllTables()
                val activeWorkspaceId = ensureLocalWorkspaceShell(
                    database = database,
                    currentTimeMillis = System.currentTimeMillis()
                )
                cloudPreferencesStore.regenerateInstallationId()
                cloudPreferencesStore.updateCloudSettings(
                    cloudState = CloudAccountState.DISCONNECTED,
                    linkedUserId = null,
                    linkedWorkspaceId = null,
                    linkedEmail = null,
                    activeWorkspaceId = activeWorkspaceId
                )
                cloudPreferencesStore.clearAccountDeletionState()
            }
        }
    }

    /**
     * Explicit user-confirmed recovery escape hatch. This destroys local data
     * only after a blocking credential recovery state is active, and it does
     * not contact cloud services.
     */
    suspend fun eraseLocalDataForCredentialRecovery() {
        withContext(Dispatchers.IO) {
            resetMutex.withLock {
                require(cloudPreferencesStore.loadCloudCredentialRecoveryState() != null) {
                    "Local credential recovery erase requires an active recovery state."
                }
                database.clearAllTables()
                val activeWorkspaceId = ensureLocalWorkspaceShell(
                    database = database,
                    currentTimeMillis = System.currentTimeMillis()
                )
                cloudPreferencesStore.regenerateInstallationId()
                cloudPreferencesStore.updateCloudSettings(
                    cloudState = CloudAccountState.DISCONNECTED,
                    linkedUserId = null,
                    linkedWorkspaceId = null,
                    linkedEmail = null,
                    activeWorkspaceId = activeWorkspaceId
                )
                cloudPreferencesStore.clearAccountDeletionState()
                cloudPreferencesStore.clearCredentials()
                cloudPreferencesStore.clearPendingGuestUpgrade()
                cloudPreferencesStore.clearAccountPreferences()
                aiChatPreferencesStore.clearConsent()
                aiChatHistoryStore.clearAllState()
                guestAiSessionStore.clearAllSessions()
                onCloudIdentityReset()
                cloudPreferencesStore.clearCloudCredentialRecoveryState()
            }
        }
    }

    /**
     * Drops cloud identity without destroying the local shell or regenerating
     * the installation identity. Use this for recoverable reconciliation
     * failures where we want an explicit disconnected state instead of a full
     * local reset.
     */
    suspend fun disconnectCloudIdentityPreservingLocalState() {
        withContext(Dispatchers.IO) {
            resetMutex.withLock {
                cloudPreferencesStore.clearCredentials()
                cloudPreferencesStore.clearAccountPreferences()
                database.syncStateDao().clearBlockedSyncState()
                val activeWorkspaceId = ensureLocalWorkspaceShell(
                    database = database,
                    currentTimeMillis = System.currentTimeMillis()
                )
                cloudPreferencesStore.updateCloudSettings(
                    cloudState = CloudAccountState.DISCONNECTED,
                    linkedUserId = null,
                    linkedWorkspaceId = null,
                    linkedEmail = null,
                    activeWorkspaceId = activeWorkspaceId
                )
                cloudPreferencesStore.clearAccountDeletionState()
            }
        }
    }
}
