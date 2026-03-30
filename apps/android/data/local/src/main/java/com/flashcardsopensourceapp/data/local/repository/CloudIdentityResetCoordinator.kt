package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class CloudIdentityResetCoordinator(
    private val database: AppDatabase,
    private val cloudPreferencesStore: CloudPreferencesStore,
    private val aiChatPreferencesStore: AiChatPreferencesStore,
    private val aiChatHistoryStore: AiChatHistoryStore,
    private val guestAiSessionStore: GuestAiSessionStore
) {
    private val resetMutex = Mutex()

    suspend fun resetLocalStateForCloudIdentityChange() {
        withContext(Dispatchers.IO) {
            resetMutex.withLock {
                cloudPreferencesStore.clearCredentials()
                aiChatPreferencesStore.clearConsent()
                aiChatHistoryStore.clearAllState()
                guestAiSessionStore.clearAllSessions()
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
}
