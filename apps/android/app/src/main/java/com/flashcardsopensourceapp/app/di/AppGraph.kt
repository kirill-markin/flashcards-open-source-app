package com.flashcardsopensourceapp.app.di

import android.content.Context
import com.flashcardsopensourceapp.app.AutoSyncController
import com.flashcardsopensourceapp.app.navigation.AppPackageInfo
import com.flashcardsopensourceapp.app.navigation.loadPackageInfo
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenController
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.app.notifications.ReviewNotificationsManager
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.ai.AiChatLiveRemoteService
import com.flashcardsopensourceapp.data.local.ai.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.AiCoroutineDispatchers
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.buildAppDatabase
import com.flashcardsopensourceapp.data.local.database.closeAppDatabase
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudOperationCoordinator
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data object Ready : AppStartupState
    data class Failed(val message: String) : AppStartupState
}

class AppGraph(
    context: Context
) {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val startupStateMutable = MutableStateFlow<AppStartupState>(AppStartupState.Loading)
    private var startupJob: Job? = null

    internal val appPackageInfo: AppPackageInfo = loadPackageInfo(context = context)
    val appMessageBus = AppMessageBus()
    val visibleAppScreenController = VisibleAppScreenController()
    val appHandoffCoordinator = AppHandoffCoordinator()
    val database: AppDatabase = buildAppDatabase(context = context)
    private val cloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
    private val cloudRemoteService = CloudRemoteService()
    private val aiChatPreferencesStore = AiChatPreferencesStore(context = context)
    private val aiChatHistoryStore = AiChatHistoryStore(context = context)
    private val guestAiSessionStore = GuestAiSessionStore(context = context)
    val reviewPreferencesStore: ReviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
    val reviewNotificationsStore: ReviewNotificationsStore = SharedPreferencesReviewNotificationsStore(context = context)
    private val aiCoroutineDispatchers = AiCoroutineDispatchers(io = Dispatchers.IO)
    private val aiChatLiveRemoteService = AiChatLiveRemoteService(dispatchers = aiCoroutineDispatchers)
    private val aiChatRemoteService = AiChatRemoteService(
        dispatchers = aiCoroutineDispatchers,
        liveRemoteService = aiChatLiveRemoteService
    )
    private val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = cloudPreferencesStore
    )
    private val cloudOperationCoordinator = CloudOperationCoordinator()
    private val cloudIdentityResetCoordinator = CloudIdentityResetCoordinator(
        database = database,
        cloudPreferencesStore = cloudPreferencesStore,
        aiChatPreferencesStore = aiChatPreferencesStore,
        aiChatHistoryStore = aiChatHistoryStore,
        guestAiSessionStore = guestAiSessionStore
    )
    private val cloudGuestSessionCoordinator = CloudGuestSessionCoordinator(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = cloudOperationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        aiChatRemoteService = aiChatRemoteService,
        appVersion = appPackageInfo.versionName
    )

    val cloudAccountRepository: CloudAccountRepository = LocalCloudAccountRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = cloudOperationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        appVersion = appPackageInfo.versionName
    )
    private val localSyncRepository = LocalSyncRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = cloudOperationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        cloudGuestSessionCoordinator = cloudGuestSessionCoordinator,
        appVersion = appPackageInfo.versionName
    )
    val syncRepository: SyncRepository = localSyncRepository
    val autoSyncEventRepository: AutoSyncEventRepository = localSyncRepository
    val autoSyncController = AutoSyncController(
        appScope = appScope,
        autoSyncEventRepository = autoSyncEventRepository
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
        database = database,
        preferencesStore = cloudPreferencesStore,
        cloudRemoteService = cloudRemoteService,
        cloudGuestSessionCoordinator = cloudGuestSessionCoordinator,
        syncRepository = syncRepository,
        aiChatRemoteService = aiChatRemoteService,
        historyStore = aiChatHistoryStore,
        aiChatPreferencesStore = aiChatPreferencesStore
    )
    val reviewNotificationsManager = ReviewNotificationsManager(
        context = context,
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        reviewNotificationsStore = reviewNotificationsStore
    )
    val startupState: StateFlow<AppStartupState> = startupStateMutable.asStateFlow()

    init {
        startStartup()
    }

    private fun startStartup() {
        startupJob?.cancel()
        startupStateMutable.value = AppStartupState.Loading
        startupJob = appScope.launch {
            try {
                cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
                ensureLocalWorkspaceShell(currentTimeMillis = System.currentTimeMillis())
                cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
                cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()
                startupStateMutable.value = AppStartupState.Ready
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                startupStateMutable.value = AppStartupState.Failed(
                    message = error.message ?: "Android startup failed."
                )
            }
        }
    }

    suspend fun ensureLocalWorkspaceShell(currentTimeMillis: Long) {
        ensureLocalWorkspaceShell(
            database = database,
            currentTimeMillis = currentTimeMillis
        )
        cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
    }

    suspend fun awaitStartup() {
        when (val currentStartupState = startupState.first { state ->
            state !is AppStartupState.Loading
        }) {
            AppStartupState.Ready -> Unit
            is AppStartupState.Failed -> {
                throw IllegalStateException(currentStartupState.message)
            }

            AppStartupState.Loading -> {
                throw IllegalStateException("Android startup is still loading.")
            }
        }
    }

    fun retryStartup() {
        startStartup()
    }

    fun close() {
        startupJob?.cancel()
        reviewNotificationsManager.close()
        appScope.cancel()
        closeAppDatabase(database = database)
    }
}
