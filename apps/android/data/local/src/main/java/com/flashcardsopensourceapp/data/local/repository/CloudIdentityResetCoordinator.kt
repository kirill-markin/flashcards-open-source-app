package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder
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
    private val demoDataSeeder: DemoDataSeeder
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
                demoDataSeeder.seedIfNeeded(currentTimeMillis = System.currentTimeMillis())
                val activeWorkspaceId = database.workspaceDao().loadWorkspace()?.workspaceId
                cloudPreferencesStore.regenerateDeviceId()
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
