package com.flashcardsopensourceapp.app.di

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import com.flashcardsopensourceapp.app.AutoSyncController
import com.flashcardsopensourceapp.app.navigation.AppPackageInfo
import com.flashcardsopensourceapp.app.navigation.loadPackageInfo
import com.flashcardsopensourceapp.app.ProgressContextRefreshController
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.app.prompts.feedback.FeedbackPromptController
import com.flashcardsopensourceapp.app.prompts.feedback.SharedPreferencesFeedbackPromptStore
import com.flashcardsopensourceapp.app.prompts.feedback.feedbackPromptIdentityKey
import com.flashcardsopensourceapp.app.prompts.guestreview.GuestSignInAfterReviewPromptController
import com.flashcardsopensourceapp.app.prompts.guestreview.SharedPreferencesGuestSignInAfterReviewPromptStore
import com.flashcardsopensourceapp.app.store.NoOpStoreReviewAnalyticsReporter
import com.flashcardsopensourceapp.app.store.StoreReviewActivityProvider
import com.flashcardsopensourceapp.app.store.StoreReviewRequestManager
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.core.ui.TestModeStore
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenController
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.app.notifications.ReviewNotificationsManager
import com.flashcardsopensourceapp.app.notifications.AndroidStrictRemindersScheduler
import com.flashcardsopensourceapp.app.notifications.StrictRemindersManager
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatLiveRemoteService
import com.flashcardsopensourceapp.data.local.ai.store.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.store.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.remote.AiCoroutineDispatchers
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteService
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.core.buildAppDatabase
import com.flashcardsopensourceapp.data.local.database.core.closeAppDatabase
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesStoreReviewRequestStore
import com.flashcardsopensourceapp.data.local.review.StoreReviewRequestStore
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.FeedbackRepository
import com.flashcardsopensourceapp.data.local.repository.ai.LocalAiChatRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cards.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.decks.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.feedback.LocalFeedbackRepository
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressRepository
import com.flashcardsopensourceapp.data.local.repository.review.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.workspace.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.shared.SystemTimeProvider
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
import okhttp3.OkHttpClient
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
    context: Context,
    val observability: AppObservability,
    private val okHttpClient: OkHttpClient
) {
    private val appJob = SupervisorJob()
    // Backstop for any uncaught exception escaping an appScope.launch site so the
    // process never crashes on a missed try/catch. Coroutine machinery filters
    // CancellationException out before it reaches this handler.
    private val appScopeExceptionHandler = CoroutineExceptionHandler { _, error ->
        observability.captureException(
            event = AndroidExceptionIssueEvent.AppScopeUncaughtException(
                throwable = error,
                appVersion = appPackageInfo.versionName,
                clientVersion = appPackageInfo.versionName,
                versionCode = appPackageInfo.longVersionCode.toInt()
            )
        )
        Log.w(
            appGraphLogTag,
            "event=app_scope_uncaught_exception ${renderSanitizedThrowableLogFields(error = error)}"
        )
    }
    private val appScope = CoroutineScope(appJob + Dispatchers.IO + appScopeExceptionHandler)
    private val startupStateMutable = MutableStateFlow<AppStartupState>(AppStartupState.Loading)
    private var startupJob: Job? = null
    private var cloudIdentityObserverJob: Job? = null
    private var reviewHistoryAppliedObserverJob: Job? = null

    internal val appPackageInfo: AppPackageInfo = loadPackageInfo(context = context)
    val appMessageBus = AppMessageBus()
    val testModeStore = TestModeStore(context = context.applicationContext)
    val visibleAppScreenController = VisibleAppScreenController()
    val storeReviewActivityProvider = StoreReviewActivityProvider()
    val cloudCredentialRecoveryGateViewModelStoreOwner: ViewModelStoreOwner =
        object : ViewModelStoreOwner {
            override val viewModelStore: ViewModelStore = ViewModelStore()
        }
    val appHandoffCoordinator = AppHandoffCoordinator()
    val database: AppDatabase = buildAppDatabase(context = context)
    private val cloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
    private val cloudRemoteService = CloudRemoteService(
        okHttpClient = okHttpClient,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    private val aiChatPreferencesStore = AiChatPreferencesStore(context = context)
    private val aiChatHistoryStore = AiChatHistoryStore(context = context)
    private val guestAiSessionStore = GuestAiSessionStore(context = context)
    val reviewPreferencesStore: ReviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
    val storeReviewRequestStore: StoreReviewRequestStore = SharedPreferencesStoreReviewRequestStore(context = context)
    private val guestSignInAfterReviewPromptStore = SharedPreferencesGuestSignInAfterReviewPromptStore(
        context = context
    )
    private val feedbackPromptStore = SharedPreferencesFeedbackPromptStore(context = context)
    private val notificationsStore = SharedPreferencesReviewNotificationsStore(context = context)
    val reviewNotificationsStore: ReviewNotificationsStore = notificationsStore
    val strictRemindersStore: StrictRemindersStore = notificationsStore
    private val aiCoroutineDispatchers = AiCoroutineDispatchers(io = Dispatchers.IO)
    private val localProgressCacheStore = LocalProgressCacheStore(
        database = database,
        timeProvider = SystemTimeProvider
    )
    private val aiChatLiveRemoteService = AiChatLiveRemoteService(
        dispatchers = aiCoroutineDispatchers,
        okHttpClient = okHttpClient,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    private val aiChatRemoteService = AiChatRemoteService(
        dispatchers = aiCoroutineDispatchers,
        liveRemoteService = aiChatLiveRemoteService,
        okHttpClient = okHttpClient,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
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
        reviewNotificationsStore = reviewNotificationsStore,
        strictRemindersStore = strictRemindersStore,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    val strictRemindersManager = StrictRemindersManager(
        strictRemindersStore = strictRemindersStore,
        reviewLogDao = database.reviewLogDao(),
        scheduler = strictRemindersScheduler,
        zoneIdProvider = ZoneId::systemDefault,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    val storeReviewRequestManager = StoreReviewRequestManager(
        context = context,
        reviewLogDao = database.reviewLogDao(),
        storeReviewRequestStore = storeReviewRequestStore,
        appVersion = appPackageInfo.versionName,
        installationIdProvider = {
            cloudPreferencesStore.currentCloudSettings().installationId
        },
        analyticsReporter = NoOpStoreReviewAnalyticsReporter,
        zoneIdProvider = ZoneId::systemDefault,
        currentTimeMillisProvider = {
            System.currentTimeMillis()
        }
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
        guestSessionCreator = aiChatRemoteService,
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
    val feedbackRepository: FeedbackRepository = LocalFeedbackRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        cloudGuestSessionCoordinator = cloudGuestSessionCoordinator,
        syncRepository = syncRepository,
        appVersion = appPackageInfo.versionName
    )
    val guestSignInAfterReviewPromptController = GuestSignInAfterReviewPromptController(
        appScope = appScope,
        cloudAccountRepository = cloudAccountRepository,
        reviewRepository = reviewRepository,
        promptStore = guestSignInAfterReviewPromptStore
    )
    val feedbackPromptController = FeedbackPromptController(
        appScope = appScope,
        context = context,
        feedbackRepository = feedbackRepository,
        reviewRepository = reviewRepository,
        promptStore = feedbackPromptStore,
        messageController = appMessageBus,
        feedbackPromptIdentityKeyProvider = {
            feedbackPromptIdentityKey(cloudSettings = cloudPreferencesStore.currentCloudSettings())
        }
    )
    val progressRepository: ProgressRepository = LocalProgressRepository(
        appScope = appScope,
        database = database,
        preferencesStore = cloudPreferencesStore,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        localProgressCacheStore = localProgressCacheStore,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt(),
        timeProvider = SystemTimeProvider
    )
    val progressContextRefreshController = ProgressContextRefreshController(
        appScope = appScope,
        progressRepository = progressRepository,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
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

    private fun startCloudIdentityObserver() {
        cloudIdentityObserverJob?.cancel()
        cloudIdentityObserverJob = appScope.launch {
            cloudPreferencesStore.observeCloudSettings().collect { cloudSettings ->
                val identity = createCloudObservationIdentity(
                    cloudSettings = cloudSettings,
                    appPackageInfo = appPackageInfo
                )
                if (identity == null) {
                    observability.clearCloudIdentity()
                } else {
                    observability.setCloudIdentity(identity = identity)
                }
            }
        }
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
                startCloudIdentityObserver()
                ensureLocalWorkspaceShell(currentTimeMillis = System.currentTimeMillis())
                cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
                cloudGuestSessionCoordinator.reconcilePersistedCloudStateForStartup()
                startupStateMutable.value = AppStartupState.Ready
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                observability.captureException(
                    event = AndroidExceptionIssueEvent.AppStartupException(
                        throwable = error,
                        startupPhase = "initial_startup",
                        appVersion = appPackageInfo.versionName,
                        clientVersion = appPackageInfo.versionName,
                        versionCode = appPackageInfo.longVersionCode.toInt()
                    )
                )
                Log.w(
                    appGraphLogTag,
                    "event=app_startup_exception ${renderSanitizedThrowableLogFields(error = error)}"
                )
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

    fun currentCloudCredentialRecoveryState(): CloudCredentialRecoveryState? {
        return cloudPreferencesStore.loadCloudCredentialRecoveryState()
    }

    fun retryStartup() {
        startStartup()
    }

    fun refreshAccountContextInBackground(source: String) {
        appScope.launch {
            try {
                cloudAccountRepository.refreshAccountContext()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(
                    appGraphLogTag,
                    "event=account_context_refresh_failed source=$source ${renderSanitizedThrowableLogFields(error = error)}"
                )
            }
        }
    }

    suspend fun close() {
        cloudCredentialRecoveryGateViewModelStoreOwner.viewModelStore.clear()
        startupJob?.cancelAndJoin()
        cloudIdentityObserverJob?.cancelAndJoin()
        reviewHistoryAppliedObserverJob?.cancelAndJoin()
        reviewNotificationsManager.close()
        strictRemindersManager.close()
        appJob.cancelAndJoin()
        closeAppDatabase(database = database)
    }
}

private fun createCloudObservationIdentity(
    cloudSettings: CloudSettings,
    appPackageInfo: AppPackageInfo
): CloudObservationIdentity? {
    if (
        cloudSettings.cloudState != CloudAccountState.GUEST &&
        cloudSettings.cloudState != CloudAccountState.LINKED
    ) {
        return null
    }

    return CloudObservationIdentity(
        userId = cloudSettings.linkedUserId?.trim()?.ifEmpty { null } ?: cloudSettings.installationId,
        workspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId,
        installationId = cloudSettings.installationId,
        appVersion = appPackageInfo.versionName,
        clientVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
}
