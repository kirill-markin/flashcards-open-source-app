package com.flashcardsopensourceapp.app.di

import android.content.Context
import android.util.Log
import com.flashcardsopensourceapp.app.AutoSyncController
import com.flashcardsopensourceapp.app.navigation.AppPackageInfo
import com.flashcardsopensourceapp.app.navigation.loadPackageInfo
import com.flashcardsopensourceapp.app.ProgressContextRefreshController
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenController
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.app.notifications.ReviewNotificationsManager
import com.flashcardsopensourceapp.app.notifications.AndroidStrictRemindersScheduler
import com.flashcardsopensourceapp.app.notifications.StrictRemindersManager
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
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.ai.LocalAiChatRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressRepository
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.ZoneId

private const val appGraphLogTag: String = "AppGraph"

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data object Ready : AppStartupState
    data class Failed(val message: String) : AppStartupState
}

data class AppGuestCloudSession(
    val workspaceId: String
)

class AppGraph(
    context: Context
) {
    private val appJob = SupervisorJob()
    // Backstop for any uncaught exception escaping an appScope.launch site so the
    // process never crashes on a missed try/catch. Coroutine machinery filters
    // CancellationException out before it reaches this handler.
    private val appScopeExceptionHandler = CoroutineExceptionHandler { _, error ->
        Log.w(appGraphLogTag, "event=app_scope_uncaught_exception", error)
    }
    private val appScope = CoroutineScope(appJob + Dispatchers.IO + appScopeExceptionHandler)
    private val startupStateMutable = MutableStateFlow<AppStartupState>(AppStartupState.Loading)
    private var startupJob: Job? = null
    private var reviewHistoryAppliedObserverJob: Job? = null

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
    private val notificationsStore = SharedPreferencesReviewNotificationsStore(context = context)
    val reviewNotificationsStore: ReviewNotificationsStore = notificationsStore
    val strictRemindersStore: StrictRemindersStore = notificationsStore
    private val aiCoroutineDispatchers = AiCoroutineDispatchers(io = Dispatchers.IO)
    private val localProgressCacheStore = LocalProgressCacheStore(
        database = database,
        timeProvider = SystemTimeProvider
    )
    private val aiChatLiveRemoteService = AiChatLiveRemoteService(dispatchers = aiCoroutineDispatchers)
    private val aiChatRemoteService = AiChatRemoteService(
        dispatchers = aiCoroutineDispatchers,
        liveRemoteService = aiChatLiveRemoteService
    )
    internal val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = SystemTimeProvider
    )
    private val strictRemindersScheduler = AndroidStrictRemindersScheduler(context = context)
    private val cloudOperationCoordinator = CloudOperationCoordinator()
    val reviewNotificationsManager = ReviewNotificationsManager(
        context = context,
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        reviewNotificationsStore = reviewNotificationsStore
    )
    val strictRemindersManager = StrictRemindersManager(
        strictRemindersStore = strictRemindersStore,
        reviewLogDao = database.reviewLogDao(),
        scheduler = strictRemindersScheduler,
        zoneIdProvider = ZoneId::systemDefault
    )
    private val cloudIdentityResetCoordinator = CloudIdentityResetCoordinator(
        database = database,
        cloudPreferencesStore = cloudPreferencesStore,
        aiChatPreferencesStore = aiChatPreferencesStore,
        aiChatHistoryStore = aiChatHistoryStore,
        guestAiSessionStore = guestAiSessionStore,
        onCloudIdentityReset = {
            strictRemindersManager.clearForCloudIdentityReset()
        }
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
        syncLocalStore = syncLocalStore,
        localProgressCacheStore = localProgressCacheStore
    )
    val progressRepository: ProgressRepository = LocalProgressRepository(
        appScope = appScope,
        database = database,
        preferencesStore = cloudPreferencesStore,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = SystemTimeProvider
    )
    val progressContextRefreshController = ProgressContextRefreshController(
        appScope = appScope,
        progressRepository = progressRepository
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
    val startupState: StateFlow<AppStartupState> = startupStateMutable.asStateFlow()

    init {
        startReviewHistoryAppliedObserver()
        startStartup()
    }

    private fun startReviewHistoryAppliedObserver() {
        reviewHistoryAppliedObserverJob?.cancel()
        reviewHistoryAppliedObserverJob = appScope.launch {
            syncLocalStore.observeReviewHistoryChangedEvents().collect { event ->
                val nowMillis = System.currentTimeMillis()
                val latestReviewedAtMillis = event.latestReviewedAtMillis
                if (latestReviewedAtMillis != null) {
                    strictRemindersManager.recordImportedReviewHistory(
                        importedReviewAtMillis = latestReviewedAtMillis,
                        nowMillis = nowMillis
                    )
                } else {
                    strictRemindersManager.reconcileStrictReminders(
                        trigger = StrictRemindersReconcileTrigger.REVIEW_HISTORY_IMPORTED,
                        nowMillis = nowMillis
                    )
                }
            }
        }
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

    suspend fun ensureGuestCloudSession(workspaceId: String): AppGuestCloudSession {
        val guestSession = cloudGuestSessionCoordinator.ensureGuestCloudSession(workspaceId = workspaceId)
        return AppGuestCloudSession(
            workspaceId = guestSession.workspaceId
        )
    }

    suspend fun deleteStoredGuestCloudSessionIfPresent() {
        cloudGuestSessionCoordinator.deleteStoredGuestCloudSessionIfPresent()
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

    suspend fun close() {
        startupJob?.cancelAndJoin()
        reviewHistoryAppliedObserverJob?.cancelAndJoin()
        reviewNotificationsManager.close()
        strictRemindersManager.close()
        appJob.cancelAndJoin()
        closeAppDatabase(database = database)
    }
}
