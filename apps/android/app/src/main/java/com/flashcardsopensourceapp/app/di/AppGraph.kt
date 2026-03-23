package com.flashcardsopensourceapp.app.di

import android.content.Context
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.buildAppDatabase
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
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
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder

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
    private val aiChatRemoteService = AiChatRemoteService()
    private val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = cloudPreferencesStore
    )

    val cloudAccountRepository: CloudAccountRepository = LocalCloudAccountRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore
    )
    val syncRepository: SyncRepository = LocalSyncRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore
    )
    val cardsRepository: CardsRepository = LocalCardsRepository(
        database = database,
        syncLocalStore = syncLocalStore
    )
    val decksRepository: DecksRepository = LocalDecksRepository(
        database = database,
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

    private val demoDataSeeder = DemoDataSeeder(database = database)

    suspend fun seedDemoDataIfNeeded(currentTimeMillis: Long) {
        demoDataSeeder.seedIfNeeded(currentTimeMillis = currentTimeMillis)
    }
}
