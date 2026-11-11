package com.flashcardsopensourceapp.wear

import android.content.Context
import android.util.Log
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.ClientDeviceType
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.core.observability.analytics.NoOpAnalytics
import com.flashcardsopensourceapp.core.observability.currentClientDeviceType
import com.flashcardsopensourceapp.core.observability.resolveAutomationEnvironment
import com.flashcardsopensourceapp.data.local.ai.remote.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.ai.store.AiChatHistoryStore
import com.flashcardsopensourceapp.data.local.ai.store.AiChatPreferencesStore
import com.flashcardsopensourceapp.data.local.ai.store.AiChatStagedAttachmentStore
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.ai.store.OwnOpenAiKeyStore
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.core.buildAppDatabase
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.LocalCloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.CloudGuestSessionCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.GuestCloudSessionCreationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.LocalSyncRepository
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.review.CloudReviewMediaAssetDownloadUrlLoader
import com.flashcardsopensourceapp.data.local.repository.review.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.review.OkHttpReviewMediaAssetDownloader
import com.flashcardsopensourceapp.data.local.repository.shared.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import okhttp3.OkHttpClient

private const val wearAppGraphLogTag: String = "WearAppGraph"

class WearGuestSessionUnsupportedException : UnsupportedOperationException(
    "The watch never creates a guest session: it signs in only through the phone's handoff."
)

class WearDemoCardUnsupportedException : UnsupportedOperationException(
    "The watch never seeds the onboarding demo card: it shows only a linked workspace."
)

private object WearGuestCloudSessionCreator : GuestCloudSessionCreator {
    override suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode,
        idempotencyKey: String
    ): StoredGuestAiSession {
        throw WearGuestSessionUnsupportedException()
    }
}

/** The watch sends nothing to Sentry, so every observation goes to logcat only. */
private object WearLogcatObservability : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) = Unit

    override fun clearCloudIdentity() = Unit

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) = Unit

    override fun captureWarning(event: AndroidWarningIssueEvent) {
        Log.w(
            wearAppGraphLogTag,
            "event=observation_warning feature=${event.feature.tagValue} action=${event.action.tagValue} " +
                "statusCode=${event.tags.statusCode} code=${event.tags.code} requestId=${event.tags.requestId}"
        )
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
        Log.e(
            wearAppGraphLogTag,
            "event=observation_exception feature=${event.feature.tagValue} action=${event.action.tagValue} " +
                "error=${event.throwable.message} errorType=${event.throwable::class.java.name}"
        )
    }
}

/**
 * The smallest data graph a signed-in-only Review watch needs: its own database and installation,
 * synced directly with the official API. No AI, billing, widgets, notifications or analytics events.
 */
class WearAppGraph(context: Context) {
    private val applicationContext: Context = context.applicationContext
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val okHttpClient = OkHttpClient()

    val database: AppDatabase = buildAppDatabase(context = applicationContext)
    val cloudPreferencesStore = CloudPreferencesStore(context = applicationContext, database = database)
    val operationCoordinator = CloudOperationCoordinator()
    val reviewPreferencesStore: ReviewPreferencesStore =
        SharedPreferencesReviewPreferencesStore(context = applicationContext)
    private val clientDeviceTypeProvider: () -> ClientDeviceType = {
        currentClientDeviceType(context = applicationContext)
    }
    private val cloudRemoteService = CloudRemoteService(
        okHttpClient = okHttpClient,
        observability = WearLogcatObservability,
        appVersion = BuildConfig.VERSION_NAME,
        versionCode = BuildConfig.VERSION_CODE,
        isAutomation = resolveAutomationEnvironment(contentResolver = applicationContext.contentResolver).isAutomation,
        clientDeviceTypeProvider = clientDeviceTypeProvider
    )
    private val localProgressCacheStore = LocalProgressCacheStore(database = database, timeProvider = SystemTimeProvider)
    private val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = SystemTimeProvider
    )
    private val guestAiSessionStore = GuestAiSessionStore(context = applicationContext)

    // The reset coordinator clears these stores on every identity boundary; the watch never writes them.
    private val cloudIdentityResetCoordinator = CloudIdentityResetCoordinator(
        database = database,
        cloudPreferencesStore = cloudPreferencesStore,
        aiChatPreferencesStore = AiChatPreferencesStore(context = applicationContext),
        aiChatHistoryStore = AiChatHistoryStore(context = applicationContext),
        aiChatStagedAttachmentStore = AiChatStagedAttachmentStore(context = applicationContext),
        guestAiSessionStore = guestAiSessionStore,
        ownOpenAiKeyStore = OwnOpenAiKeyStore(context = applicationContext, scope = appScope),
        onLocalWorkspaceRecreated = {},
        onFirstReviewOnboardingPersistenceFailed = { error ->
            logWearGraphFailure(event = "first_review_onboarding_persistence_failed", error = error)
        },
        onCloudIdentityReset = {}
    )
    val reviewRepository: ReviewRepository = LocalReviewRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        syncLocalStore = syncLocalStore,
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = SystemTimeProvider,
        mediaAssetFileCacheRootDirectory = applicationContext.filesDir,
        mediaAssetDownloadUrlLoader = CloudReviewMediaAssetDownloadUrlLoader(
            preferencesStore = cloudPreferencesStore,
            remoteService = cloudRemoteService,
            operationCoordinator = operationCoordinator,
            guestSessionStore = guestAiSessionStore,
            resetCoordinator = cloudIdentityResetCoordinator
        ),
        mediaAssetDownloader = OkHttpReviewMediaAssetDownloader(okHttpClient = okHttpClient),
        analytics = NoOpAnalytics,
        onFirstReviewOnboardingPersistenceFailed = { error ->
            logWearGraphFailure(event = "first_review_onboarding_persistence_failed", error = error)
        },
        onFirstReviewOnboardingSaved = {}
    )
    private val cloudGuestSessionCoordinator = CloudGuestSessionCoordinator(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        creationCoordinator = GuestCloudSessionCreationCoordinator(
            guestSessionStore = guestAiSessionStore,
            guestSessionCreator = WearGuestCloudSessionCreator
        ),
        loadReviewMediaAssetFile = reviewRepository::loadReviewMediaAssetFile,
        appVersion = BuildConfig.VERSION_NAME
    )
    val cloudAccountRepository: LocalCloudAccountRepository = LocalCloudAccountRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        loadReviewMediaAssetFile = reviewRepository::loadReviewMediaAssetFile,
        appVersion = BuildConfig.VERSION_NAME,
        analytics = NoOpAnalytics,
        demoCardDraftProvider = { throw WearDemoCardUnsupportedException() },
        onGuestUpgradeDemoCardCleanupFailed = { _, error ->
            logWearGraphFailure(event = "guest_upgrade_demo_card_cleanup_failed", error = error)
        },
        onReviewPromptConfigFetched = {},
        onAnalyticsGuestIdentityLinkRequested = {},
        onProductAnalyticsPreferencePushRefused = {}
    )
    val syncRepository: SyncRepository = LocalSyncRepository(
        database = database,
        preferencesStore = cloudPreferencesStore,
        remoteService = cloudRemoteService,
        syncLocalStore = syncLocalStore,
        operationCoordinator = operationCoordinator,
        resetCoordinator = cloudIdentityResetCoordinator,
        guestSessionStore = guestAiSessionStore,
        cloudGuestSessionCoordinator = cloudGuestSessionCoordinator,
        loadReviewMediaAssetFile = reviewRepository::loadReviewMediaAssetFile,
        appVersion = BuildConfig.VERSION_NAME
    )

    /** Opening never seeds the demo card: the watch only ever shows a linked workspace. */
    val startup: Deferred<Unit> = appScope.async {
        cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
        ensureLocalWorkspaceShell(database = database, currentTimeMillis = System.currentTimeMillis())
        cloudPreferencesStore.hydrateCloudSettingsFromDatabase()
        Unit
    }
}

private fun logWearGraphFailure(event: String, error: Exception) {
    Log.w(wearAppGraphLogTag, "event=$event error=${error.message} errorType=${error::class.java.name}")
}
