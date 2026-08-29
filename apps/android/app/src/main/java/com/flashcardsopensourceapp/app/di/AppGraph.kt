package com.flashcardsopensourceapp.app.di

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import com.flashcardsopensourceapp.app.AutoSyncController
import com.flashcardsopensourceapp.app.TestTechnicalErrorDialogPreviewController
import com.flashcardsopensourceapp.app.enqueueMediaUploadWorker
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
import com.flashcardsopensourceapp.app.analytics.AppAnalyticsCredentialProvider
import com.flashcardsopensourceapp.app.analytics.analyticsSyncFailureReason
import com.flashcardsopensourceapp.app.analytics.isProductAnalyticsDisabledForProcess
import com.flashcardsopensourceapp.core.observability.AndroidAnalyticsObservationName
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsClient
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsIdentity
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsNetworkMonitor
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReporter
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.core.observability.shouldCaptureAndroidThrowable
import com.flashcardsopensourceapp.core.ui.AppMessageBus
import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import com.flashcardsopensourceapp.core.ui.renderTechnicalErrorDetails
import com.flashcardsopensourceapp.core.ui.TestModeStore
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenController
import com.flashcardsopensourceapp.app.navigation.AppHandoffCoordinator
import com.flashcardsopensourceapp.app.notifications.NotificationDeliveryGate
import com.flashcardsopensourceapp.app.notifications.review.ReviewReminderAttentionController
import com.flashcardsopensourceapp.app.notifications.review.ReviewNotificationsManager
import com.flashcardsopensourceapp.app.notifications.strict.AndroidStrictRemindersScheduler
import com.flashcardsopensourceapp.app.notifications.strict.StrictRemindersManager
import com.flashcardsopensourceapp.app.onboarding.seedDemoCardForNewWorkspace
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
import com.flashcardsopensourceapp.data.local.network.OkHttpSignedPutUploader
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
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
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.AnalyticsGuestSessionMinter
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestCloudSessionCreationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.FeedbackRepository
import com.flashcardsopensourceapp.data.local.repository.ai.LocalAiChatRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cards.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.decks.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.feedback.LocalFeedbackRepository
import com.flashcardsopensourceapp.data.local.repository.media.LocalManagedMediaAuthoringRepository
import com.flashcardsopensourceapp.data.local.repository.media.LocalMediaUploadTransferRepository
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressRepository
import com.flashcardsopensourceapp.data.local.repository.review.CloudReviewMediaAssetDownloadUrlLoader
import com.flashcardsopensourceapp.data.local.repository.review.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.review.OkHttpReviewMediaAssetDownloader
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.time.ZoneId

private const val appGraphLogTag: String = "AppGraph"
private const val notificationsWorkspaceReconcileInitialRetryDelayMillis: Long = 250L
private const val notificationsWorkspaceReconcileMaximumRetryDelayMillis: Long = 4_000L

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data object Ready : AppStartupState
    data class Failed(val technicalDetails: String) : AppStartupState
}

private class AppTechnicalErrorDetailsException(
    val source: String,
    technicalDetails: String
) : IllegalStateException(technicalDetails)

data class AppGuestCloudSession(
    val workspaceId: String
)

private data class NotificationsWorkspaceObservation(
    val activeWorkspaceId: String?,
    val hasMatchingLocalWorkspace: Boolean
)

class AppGraph(
    context: Context,
    val observability: AppObservability,
    private val okHttpClient: OkHttpClient
) {
    private val applicationContext: Context = context.applicationContext
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
    private var analyticsGuestIdentityLinkJob: Job? = null
    private var reviewHistoryAppliedObserverJob: Job? = null
    private var notificationsWorkspaceObserverJob: Job? = null

    internal val appPackageInfo: AppPackageInfo = loadPackageInfo(context = context)
    val appMessageBus = AppMessageBus(
        reportTechnicalError = ::captureTechnicalErrorDialogException,
        shouldReportTechnicalError = ::shouldCaptureAndroidThrowable
    )
    val testTechnicalErrorDialogPreviewController = TestTechnicalErrorDialogPreviewController()
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
    private val aiCoroutineDispatchers = AiCoroutineDispatchers(io = Dispatchers.IO)
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
    // One instance per graph, shared by both creators: its mutex is the lock that keeps the
    // analytics mint and the cloud guest restore from creating two permanent guest identities for
    // one install. `AppGraph` is rebuilt inside a running process, so this is not process-wide the
    // way `hasAttemptedAnalyticsGuestMint` in `AppAnalyticsSupport` is; two instances would each
    // hold their own mutex. Nothing can overlap across a rebuild in practice: `close()` awaits
    // `appJob.cancelAndJoin()` before the graph is dropped, so no mint of the old graph is still in
    // flight, and the only place a graph is rebuilt inside a live process is instrumentation, where
    // `isProductAnalyticsDisabledForProcess()` means the mint never runs at all.
    private val guestCloudSessionCreationCoordinator = GuestCloudSessionCreationCoordinator(
        guestSessionStore = guestAiSessionStore,
        guestSessionCreator = aiChatRemoteService
    )
    private val analyticsGuestSessionMinter = AnalyticsGuestSessionMinter(
        preferencesStore = cloudPreferencesStore,
        creationCoordinator = guestCloudSessionCreationCoordinator
    )
    private val analyticsNetworkMonitor = AnalyticsNetworkMonitor(context = context, scope = appScope)
    private val analyticsClient = AnalyticsClient(
        context = context,
        appScope = appScope,
        okHttpClient = okHttpClient,
        identity = AnalyticsIdentity(context = context),
        credentialProvider = AppAnalyticsCredentialProvider(
            cloudPreferencesStore = cloudPreferencesStore,
            guestAiSessionStore = guestAiSessionStore,
            analyticsGuestSessionMinter = analyticsGuestSessionMinter,
            reportGuestSessionMintFailure = ::reportAnalyticsGuestSessionMintFailure
        ),
        networkStateProvider = analyticsNetworkMonitor,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    val analytics: Analytics = analyticsClient
    val syncFailureAnalyticsReporter = AnalyticsSyncFailureReporter(analytics = analytics)
    val reviewPreferencesStore: ReviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
    val storeReviewRequestStore: StoreReviewRequestStore = SharedPreferencesStoreReviewRequestStore(context = context)
    private val guestSignInAfterReviewPromptStore = SharedPreferencesGuestSignInAfterReviewPromptStore(
        context = context
    )
    private val feedbackPromptStore = SharedPreferencesFeedbackPromptStore(context = context)
    private val notificationsStore = SharedPreferencesReviewNotificationsStore(context = context)
    val reviewNotificationsStore: ReviewNotificationsStore = notificationsStore
    val strictRemindersStore: StrictRemindersStore = notificationsStore
    val notificationDeliveryGate = NotificationDeliveryGate()
    val reviewReminderAttentionController = ReviewReminderAttentionController(
        reviewNotificationsStore = reviewNotificationsStore,
        reviewLogDao = database.reviewLogDao(),
        notificationDeliveryGate = notificationDeliveryGate
    )
    private val localProgressCacheStore = LocalProgressCacheStore(
        database = database,
        timeProvider = SystemTimeProvider
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
        currentWorkspaceIdProvider = {
            loadActiveNotificationWorkspaceIdOrNull()
        },
        reviewPreferencesStore = reviewPreferencesStore,
        reviewNotificationsStore = reviewNotificationsStore,
        strictRemindersStore = strictRemindersStore,
        attentionController = reviewReminderAttentionController,
        notificationDeliveryGate = notificationDeliveryGate,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt()
    )
    val strictRemindersManager = StrictRemindersManager(
        strictRemindersStore = strictRemindersStore,
        notificationsMasterEnabledProvider = {
            reviewNotificationsStore.loadSettings().isEnabled
        },
        reviewLogDao = database.reviewLogDao(),
        scheduler = strictRemindersScheduler,
        notificationDeliveryGate = notificationDeliveryGate,
        currentWorkspaceIdProvider = {
            loadActiveNotificationWorkspaceIdOrNull()
        },
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
            // Queued events belong to the person who is leaving, and the server attributes a batch
            // to the credential that carries it, so they must never survive an identity boundary.
            // `reset()` returns immediately and does no network work, so this never delays the
            // action.
            //
            // Reached from exactly the three `CloudIdentityResetCoordinator` entry points that end
            // one person's use of this install: `resetLocalStateForCloudIdentityChange` (logout, an
            // account switch detected mid-sync or mid-refresh, an account deletion, a server
            // change), `eraseLocalDataForCredentialRecovery` (the credential-recovery erase) and
            // `disconnectDeletedCloudIdentityPreservingLocalState` (a `410 ACCOUNT_DELETED` sync
            // answer, i.e. the account was deleted elsewhere).
            //
            // `disconnectCloudIdentityPreservingLocalState` deliberately does not reach here, and
            // its callers are the complete "not a boundary" set:
            //
            // - reconciliation failures, where the same person recovers from a locally inconsistent
            //   state and signs back into the same account, so rotating `anonymous_id` would split
            //   one person's history instead of protecting the next person's;
            // - `CloudGuestSessionCoordinator.clearStoredGuestCloudSessionLocalState`, which
            //   disconnects a guest whose session the server answered `GUEST_AUTH_INVALID` for.
            //   This is the least obvious member and the reason the set is enumerated rather than
            //   claimed: queued events keep the guest's `anonymous_id` into the next credential on
            //   purpose. It is the same install and the same person losing a server-side session,
            //   not a person leaving — the same reasoning that keeps the guest-to-account upgrade
            //   off this hook, where the `anonymous_id` has to carry through for
            //   `analytics.identity_links` to join the guest and the account at all.
            analytics.reset()
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
        creationCoordinator = guestCloudSessionCreationCoordinator,
        appVersion = appPackageInfo.versionName
    )
    val mediaUploadTransferRepository = LocalMediaUploadTransferRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        operationCoordinator = cloudOperationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        mediaFileRootDirectory = applicationContext.filesDir,
        signedPutUploader = OkHttpSignedPutUploader(okHttpClient = okHttpClient),
        timeProvider = SystemTimeProvider
    )
    val managedMediaAuthoringRepository = LocalManagedMediaAuthoringRepository(
        contentResolver = applicationContext.contentResolver,
        database = database,
        preferencesStore = cloudPreferencesStore,
        mediaFileRootDirectory = applicationContext.filesDir,
        ioDispatcher = Dispatchers.IO,
        timeProvider = SystemTimeProvider
    )

    val cloudAccountRepository: CloudAccountRepository = LocalCloudAccountRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = cloudOperationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        appVersion = appPackageInfo.versionName,
        onAnalyticsGuestIdentityLinkRequested = ::requestAnalyticsGuestIdentityLink
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
        autoSyncEventRepository = autoSyncEventRepository,
        reportSyncFailure = { error ->
            syncFailureAnalyticsReporter.reportFailure(
                reason = analyticsSyncFailureReason(error = error)
            )
        },
        reportSyncSucceeded = syncFailureAnalyticsReporter::reportSuccess
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
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = SystemTimeProvider,
        mediaAssetFileCacheRootDirectory = context.filesDir,
        mediaAssetDownloadUrlLoader = CloudReviewMediaAssetDownloadUrlLoader(
            preferencesStore = cloudPreferencesStore,
            remoteService = cloudRemoteService,
            operationCoordinator = cloudOperationCoordinator,
            guestSessionStore = guestAiSessionStore,
            resetCoordinator = cloudIdentityResetCoordinator
        ),
        mediaAssetDownloader = OkHttpReviewMediaAssetDownloader(okHttpClient = okHttpClient)
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
        promptStore = guestSignInAfterReviewPromptStore,
        analytics = analytics
    )
    val feedbackPromptController = FeedbackPromptController(
        appScope = appScope,
        context = context,
        feedbackRepository = feedbackRepository,
        reviewRepository = reviewRepository,
        promptStore = feedbackPromptStore,
        messageController = appMessageBus,
        observability = observability,
        appVersion = appPackageInfo.versionName,
        versionCode = appPackageInfo.longVersionCode.toInt(),
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
        if (isProductAnalyticsDisabledForProcess()) {
            // Instrumentation must never post synthetic rows into production `product_events`.
            analytics.setEnabled(enabled = false)
        }
        analyticsNetworkMonitor.startObservingConnectivityRestored(
            onConnectivityRestored = analytics::onConnectivityRestored
        )
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
                if (
                    cloudSettings.cloudState == CloudAccountState.GUEST ||
                    cloudSettings.cloudState == CloudAccountState.LINKED
                ) {
                    enqueueMediaUploadWorker(context = applicationContext, initialDelayMillis = 0L)
                }
            }
        }
    }

    /**
     * Claims the analytics guest identity for the signed-in account, on the two occasions that can
     * produce one: a completed sign-in, and each app start, which is the retry the link needs. It is
     * a no-op once that credential is gone, once cloud state is not `LINKED`, and for any guest that
     * owns cloud data.
     *
     * Requested explicitly rather than collected off cloud settings. Sign-in emits several settings
     * changes in quick succession, and a `collectLatest` over them cancels an in-flight link on each
     * one — exactly when the link is most wanted; the sign-in's own `LINKED` write also lands one
     * statement before its credentials are stored.
     *
     * It runs on a job of its own so nothing awaits it: a failure only leaves the credential in
     * place for the next attempt. Concurrent requests do not race — the coordinator serializes them
     * on its own mutex — and cancelling the job cancels at most the attempt in flight. A second
     * request replaces the field without cancelling the job it held, so `close()` joins only the
     * newest one; `appJob.cancelAndJoin()` right below it cancels and awaits every other launch on
     * this scope, which is what covers the rest. A change that gives this link a scope of its own,
     * or drops that join, has to cancel the previous job here instead.
     *
     * The process-wide analytics kill switch stops it before the identity is requested, not merely
     * before the events leave: `POST /v1/guest-auth/identity/link` writes an append-only,
     * first-link-wins `analytics.identity_links` row with no repair path, and
     * `flashcards-ai-chat-guest-session` survives `adb install -r`, so an instrumentation run
     * finding an earlier normal launch's analytics guest would permanently claim a real person's
     * pre-sign-in tail for the account it signs into. Nothing about an opted-out process may reach
     * the backend, which is the same rule the mint in `AppAnalyticsCredentialProvider` follows.
     */
    private fun requestAnalyticsGuestIdentityLink() {
        if (isProductAnalyticsDisabledForProcess()) {
            return
        }
        analyticsGuestIdentityLinkJob = appScope.launch {
            try {
                cloudGuestSessionCoordinator.linkAnalyticsGuestIdentityToSignedInAccount()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(
                    appGraphLogTag,
                    "event=analytics_guest_identity_link_retry " +
                        renderSanitizedThrowableLogFields(error = error)
                )
            }
        }
    }

    /**
     * The analytics credential provider's only request, reported under its own name so an offline
     * first launch is not filed as an analytics queue-store read failure.
     */
    private fun reportAnalyticsGuestSessionMintFailure() {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.AnalyticsPipelineWarning(
                name = AndroidAnalyticsObservationName.GUEST_CREDENTIAL_MINT_FAILED,
                eventCount = null,
                statusCode = null,
                appVersion = appPackageInfo.versionName,
                clientVersion = appPackageInfo.versionName,
                versionCode = appPackageInfo.longVersionCode.toInt()
            )
        )
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
                    reviewReminderAttentionController.reconcileWithReviewHistory()
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
                requestAnalyticsGuestIdentityLink()
                val initialWorkspaceId = workspaceRepository.observeWorkspace().first()?.workspaceId
                if (initialWorkspaceId != null) {
                    reviewNotificationsStore.migrateLegacySettings(
                        currentWorkspaceId = initialWorkspaceId
                    )
                }
                startNotificationsWorkspaceObserver(initialWorkspaceId = initialWorkspaceId)
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
                    technicalDetails = renderTechnicalErrorDetails(error = error)
                )
            }
        }
    }

    private fun startNotificationsWorkspaceObserver(initialWorkspaceId: String?) {
        notificationsWorkspaceObserverJob?.cancel()
        notificationsWorkspaceObserverJob = appScope.launch {
            var previousWorkspaceId = initialWorkspaceId
            combine(
                database.workspaceDao().observeWorkspaces(),
                cloudPreferencesStore.observeCloudSettings()
            ) { workspaces, cloudSettings ->
                val activeWorkspaceId = cloudSettings.activeWorkspaceId
                NotificationsWorkspaceObservation(
                    activeWorkspaceId = activeWorkspaceId,
                    hasMatchingLocalWorkspace = if (activeWorkspaceId == null) {
                        workspaces.isEmpty()
                    } else {
                        workspaces.any { workspace ->
                            workspace.workspaceId == activeWorkspaceId
                        }
                    }
                )
            }.collectLatest { observation ->
                if (observation.hasMatchingLocalWorkspace.not()) {
                    return@collectLatest
                }

                val workspaceId = observation.activeWorkspaceId
                if (workspaceId == previousWorkspaceId) {
                    return@collectLatest
                }

                reconcileNotificationsForWorkspaceUntilSuccessful(workspaceId = workspaceId)
                previousWorkspaceId = workspaceId
            }
        }
    }

    private suspend fun reconcileNotificationsForWorkspaceUntilSuccessful(workspaceId: String?) {
        var attempt = 1
        var retryDelayMillis = notificationsWorkspaceReconcileInitialRetryDelayMillis
        while (true) {
            try {
                reconcileNotificationsForWorkspace(workspaceId = workspaceId)
                return
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(
                    appGraphLogTag,
                    "event=notifications_workspace_reconcile_retry " +
                        "workspace_id=${workspaceId ?: "none"} " +
                        "attempt=$attempt retry_delay_ms=$retryDelayMillis " +
                        renderSanitizedThrowableLogFields(error = error)
                )
                delay(timeMillis = retryDelayMillis)
                retryDelayMillis = minOf(
                    retryDelayMillis * 2L,
                    notificationsWorkspaceReconcileMaximumRetryDelayMillis
                )
                if (attempt < Int.MAX_VALUE) {
                    attempt += 1
                }
            }
        }
    }

    suspend fun loadActiveNotificationWorkspaceIdOrNull(): String? {
        val activeWorkspaceId = cloudPreferencesStore.currentCloudSettings().activeWorkspaceId
            ?: return null
        return database.workspaceDao()
            .loadWorkspaceById(workspaceId = activeWorkspaceId)
            ?.workspaceId
    }

    private suspend fun reconcileNotificationsForWorkspace(workspaceId: String?) {
        if (workspaceId != null) {
            reviewNotificationsStore.migrateLegacySettings(currentWorkspaceId = workspaceId)
        }
        reviewReminderAttentionController.clear()
        val nowMillis = System.currentTimeMillis()
        reviewNotificationsManager.reconcileCurrentWorkspaceReviewNotificationsAndWait(
            trigger = ReviewNotificationsReconcileTrigger.WORKSPACE_CHANGED,
            nowMillis = nowMillis
        )
        strictRemindersManager.reconcileStrictRemindersAndWait(
            trigger = StrictRemindersReconcileTrigger.WORKSPACE_CHANGED,
            nowMillis = nowMillis
        )
    }

    suspend fun ensureLocalWorkspaceShell(currentTimeMillis: Long) {
        val localWorkspaceShell = ensureLocalWorkspaceShell(
            database = database,
            currentTimeMillis = currentTimeMillis
        )
        cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
        if (localWorkspaceShell.didCreateWorkspace) {
            // The demo card is onboarding decoration, so a seed failure is reported and
            // swallowed instead of failing startup, exactly like the web client does.
            try {
                seedDemoCardForNewWorkspace(
                    context = applicationContext,
                    database = database,
                    cardsRepository = cardsRepository,
                    workspaceId = localWorkspaceShell.workspaceId
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                observability.captureException(
                    event = AndroidExceptionIssueEvent.AppStartupException(
                        throwable = error,
                        startupPhase = "demo_card_seed",
                        appVersion = appPackageInfo.versionName,
                        clientVersion = appPackageInfo.versionName,
                        versionCode = appPackageInfo.longVersionCode.toInt()
                    )
                )
                Log.w(
                    appGraphLogTag,
                    "event=demo_card_seed_failed " +
                        "workspace_id=${localWorkspaceShell.workspaceId} " +
                        renderSanitizedThrowableLogFields(error = error)
                )
            }
        }
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
                throw IllegalStateException(currentStartupState.technicalDetails)
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

    fun showTechnicalErrorDialog(
        source: String,
        reportId: String,
        title: String,
        message: String,
        technicalDetails: String
    ) {
        appMessageBus.showTechnicalError(
            error = AppTechnicalError(
                reportId = reportId,
                title = title,
                message = message,
                technicalDetails = technicalDetails
            ),
            throwable = AppTechnicalErrorDetailsException(
                source = source,
                technicalDetails = technicalDetails
            )
        )
    }

    fun showReportedTechnicalErrorDialog(
        title: String,
        message: String,
        technicalDetails: String
    ) {
        appMessageBus.showReportedTechnicalError(
            error = AppTechnicalError(
                reportId = "already-reported",
                title = title,
                message = message,
                technicalDetails = technicalDetails
            )
        )
    }

    private fun captureTechnicalErrorDialogException(throwable: Throwable) {
        val source = (throwable as? AppTechnicalErrorDetailsException)?.source ?: "unknown"
        observability.captureException(
            event = AndroidExceptionIssueEvent.AppTechnicalErrorDialogException(
                throwable = throwable,
                source = source,
                detail = throwable.message,
                appVersion = appPackageInfo.versionName,
                clientVersion = appPackageInfo.versionName,
                versionCode = appPackageInfo.longVersionCode.toInt()
            )
        )
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
        analyticsNetworkMonitor.stopObservingConnectivityRestored()
        cloudCredentialRecoveryGateViewModelStoreOwner.viewModelStore.clear()
        startupJob?.cancelAndJoin()
        cloudIdentityObserverJob?.cancelAndJoin()
        analyticsGuestIdentityLinkJob?.cancelAndJoin()
        reviewHistoryAppliedObserverJob?.cancelAndJoin()
        notificationsWorkspaceObserverJob?.cancelAndJoin()
        reviewNotificationsManager.close()
        strictRemindersManager.close()
        appJob.cancelAndJoin()
        // After the scope that owns the analytics worker is gone, so nothing is using the queue.
        analyticsClient.close()
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
