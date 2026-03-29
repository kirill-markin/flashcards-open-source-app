package com.flashcardsopensourceapp.app.di

import android.content.Context
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.app.notifications.ReviewNotificationsManager
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.buildAppDatabase
import com.flashcardsopensourceapp.data.local.database.closeAppDatabase
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalAiChatRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository

class AppGraph(
    context: Context
) {
    val appMessageBus = AppMessageBus()
    val appHandoffCoordinator = AppHandoffCoordinator()
    val database: AppDatabase = buildAppDatabase(context = context)
    private val cloudPreferencesStore = CloudPreferencesStore(context = context)
    private val cloudRemoteService = CloudRemoteService()
    private val aiChatPreferencesStore = AiChatPreferencesStore(context = context)
    private val aiChatHistoryStore = AiChatHistoryStore(context = context)
    private val guestAiSessionStore = GuestAiSessionStore(context = context)
    val reviewPreferencesStore: ReviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
    val reviewNotificationsStore: ReviewNotificationsStore = SharedPreferencesReviewNotificationsStore(context = context)
    private val aiChatRemoteService = AiChatRemoteService()
    private val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = cloudPreferencesStore
    )
    private val cloudIdentityResetCoordinator = CloudIdentityResetCoordinator(
        database = database,
        cloudPreferencesStore = cloudPreferencesStore,
        aiChatPreferencesStore = aiChatPreferencesStore,
        aiChatHistoryStore = aiChatHistoryStore,
        guestAiSessionStore = guestAiSessionStore
    )

    val cloudAccountRepository: CloudAccountRepository = LocalCloudAccountRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore
    )
    val syncRepository: SyncRepository = LocalSyncRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        resetCoordinator = cloudIdentityResetCoordinator
    )
    val cardsRepository: CardsRepository = LocalCardsRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        syncLocalStore = syncLocalStore
    )
    val decksRepository: DecksRepository = LocalDecksRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        syncLocalStore = syncLocalStore
    )
    val workspaceRepository: WorkspaceRepository = LocalWorkspaceRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        syncRepository = syncRepository,
        syncLocalStore = syncLocalStore
    )
    val reviewRepository: ReviewRepository = LocalReviewRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        syncLocalStore = syncLocalStore
    )
    val aiChatRepository: AiChatRepository = LocalAiChatRepository(
        preferencesStore = cloudPreferencesStore,
        cloudRemoteService = cloudRemoteService,
        aiChatRemoteService = aiChatRemoteService,
        historyStore = aiChatHistoryStore,
        aiChatPreferencesStore = aiChatPreferencesStore,
        guestSessionStore = guestAiSessionStore
    )
    val reviewNotificationsManager = ReviewNotificationsManager(
        context = context,
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        reviewNotificationsStore = reviewNotificationsStore
    )

    init {
        restoreGuestCloudStateIfNeeded()
    }

    suspend fun ensureLocalWorkspaceShell(currentTimeMillis: Long) {
        ensureLocalWorkspaceShell(
            database = database,
            currentTimeMillis = currentTimeMillis
        )
    }

    private fun restoreGuestCloudStateIfNeeded() {
        val currentCloudSettings = cloudPreferencesStore.currentCloudSettings()
        if (
            currentCloudSettings.cloudState == CloudAccountState.LINKED
            || currentCloudSettings.cloudState == CloudAccountState.LINKING_READY
        ) {
            return
        }

        val configuration = cloudPreferencesStore.currentServerConfiguration()
        val localWorkspaceId = currentCloudSettings.activeWorkspaceId
        val guestSession = guestAiSessionStore.loadSession(
            localWorkspaceId = localWorkspaceId,
            configuration = configuration
        ) ?: guestAiSessionStore.loadAnySession(configuration = configuration)

        if (guestSession == null) {
            if (currentCloudSettings.cloudState == CloudAccountState.GUEST) {
                cloudPreferencesStore.updateCloudSettings(
                    cloudState = CloudAccountState.DISCONNECTED,
                    linkedUserId = null,
                    linkedWorkspaceId = null,
                    linkedEmail = null,
                    activeWorkspaceId = localWorkspaceId
                )
            }
            return
        }

        cloudPreferencesStore.updateCloudSettings(
            cloudState = CloudAccountState.GUEST,
            linkedUserId = guestSession.userId,
            linkedWorkspaceId = guestSession.workspaceId,
            linkedEmail = null,
            activeWorkspaceId = localWorkspaceId
        )
    }

    fun close() {
        closeAppDatabase(database = database)
    }
}
