package com.flashcardsopensourceapp.app

import android.app.Application
import android.os.Build
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import androidx.work.ExperimentalConfigurationApi
import com.flashcardsopensourceapp.app.analytics.consumeAnalyticsForegroundEntry
import com.flashcardsopensourceapp.app.analytics.markAnalyticsProcessBackgrounded
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.di.AppStartupState
import com.flashcardsopensourceapp.app.navigation.AppNotificationTapHandoffRequest
import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import com.flashcardsopensourceapp.app.notifications.analyticsNotificationKind
import com.flashcardsopensourceapp.app.observability.AndroidObservabilityStartup
import com.flashcardsopensourceapp.app.observability.startAndroidObservability
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsLaunchType
import com.flashcardsopensourceapp.data.local.model.cloud.parseCloudAppleBrowserReturn
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield

class FlashcardsApplication : Application(), Configuration.Provider {
    private val appGraphResetMutex = Mutex()
    private val appGraphLock = Any()
    private val nextAppNotificationTapRequestId = AtomicLong(0L)
    private val appGraphStateMutable = MutableStateFlow<AppGraph?>(value = null)
    private val appNotificationTapStateMutable = MutableStateFlow<AppNotificationTapHandoffRequest?>(value = null)
    private val appleSignInScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val appleSignInReturnStateMutable = MutableStateFlow<AppleSignInReturnState>(AppleSignInReturnState.Idle)
    private var appleSignInReturnForRetry: String? = null
    private var appleReturnManagementPurpose: Boolean? = null
    val appleSignInReturnState: StateFlow<AppleSignInReturnState>
        get() = appleSignInReturnStateMutable.asStateFlow()

    fun consumeAppleSignInReturn() {
        appleSignInReturnForRetry = null
        appleReturnManagementPurpose = null
        appleSignInReturnStateMutable.value = AppleSignInReturnState.Idle
    }

    fun acceptAppleSignInReturn(returned: String) {
        appleSignInScope.launch { receiveAppleSignInReturn(returned, null) }
    }

    fun retryAppleSignInReturn() {
        if (appleSignInReturnStateMutable.value != AppleSignInReturnState.StorageFailed &&
            appleSignInReturnStateMutable.value != AppleSignInReturnState.ManagementStorageFailed &&
            appleSignInReturnStateMutable.value != AppleSignInReturnState.OwnershipStorageFailed) return
        val returned = requireNotNull(appleSignInReturnForRetry) {
            "Apple sign-in has no callback awaiting a storage retry."
        }
        appleSignInReturnStateMutable.value = AppleSignInReturnState.Idle
        appleSignInScope.launch { receiveAppleSignInReturn(returned, appleReturnManagementPurpose) }
    }

    private suspend fun receiveAppleSignInReturn(value: String, expectedManagementPurpose: Boolean?) {
        var managementPurpose: Boolean? = null
        try {
            val graph = appGraph
            graph.awaitStartup()
            val hasManagementPurpose = graph.cloudAccountMethodsRepository.hasPendingManagementPurpose()
            if (hasManagementPurpose) managementPurpose = true
            val returned = parseCloudAppleBrowserReturn(value)
            val protectedPurpose: Boolean? = when {
                hasManagementPurpose -> true
                graph.cloudSocialSignInRepository.canAcceptAppleBrowserReturn(returned) -> false
                else -> null
            }
            managementPurpose = protectedPurpose.takeIf { expectedManagementPurpose == null || expectedManagementPurpose == it }
            appleReturnManagementPurpose = managementPurpose
            require(managementPurpose != null) {
                "No current protected Apple callback purpose matches this return. Start a fresh attempt."
            }
            appleSignInReturnStateMutable.value = if (managementPurpose == true) {
                AppleSignInReturnState.ManagementAccepted(graph.cloudAccountMethodsRepository.acceptAppleReturn(returned))
            } else {
                graph.cloudSocialSignInRepository.acceptAppleBrowserReturn(returned)
                    ?.let { AppleSignInReturnState.Accepted(it) } ?: AppleSignInReturnState.Unowned
            }
            appleSignInReturnForRetry = null
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            retainAppleReturnForStorageRetry(value, managementPurpose)
        } catch (_: IllegalArgumentException) {
            rejectAppleReturn(managementPurpose)
        } catch (error: IllegalStateException) {
            if (error.cause is IOException) retainAppleReturnForStorageRetry(value, null)
            else rejectAppleReturn(managementPurpose)
        }
    }

    private fun retainAppleReturnForStorageRetry(value: String, managementPurpose: Boolean?) {
        appleSignInReturnForRetry = value
        appleReturnManagementPurpose = managementPurpose
        appleSignInReturnStateMutable.value = when (managementPurpose) {
            true -> AppleSignInReturnState.ManagementStorageFailed
            false -> AppleSignInReturnState.StorageFailed
            null -> AppleSignInReturnState.OwnershipStorageFailed
        }
    }

    private fun rejectAppleReturn(managementPurpose: Boolean?) {
        appleSignInReturnForRetry = null
        appleReturnManagementPurpose = null
        appleSignInReturnStateMutable.value = when (managementPurpose) {
            true -> AppleSignInReturnState.ManagementRejected
            false -> AppleSignInReturnState.Rejected
            null -> AppleSignInReturnState.Unowned
        }
    }

    private lateinit var observabilityStartup: AndroidObservabilityStartup

    val appGraph: AppGraph
        get() = requireNotNull(appGraphOrNull) { "App graph is unavailable." }

    val appGraphOrNull: AppGraph?
        get() = synchronized(appGraphLock) {
            appGraphHolder
        }

    val appGraphState: StateFlow<AppGraph?>
        get() = appGraphStateMutable.asStateFlow()

    val appNotificationTapState: StateFlow<AppNotificationTapHandoffRequest?>
        get() = appNotificationTapStateMutable.asStateFlow()

    @get:OptIn(ExperimentalConfigurationApi::class)
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMaxSchedulerLimit(appNotificationWorkLimit)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.CINNAMON_BUN) {
                    setMarkingJobsAsImportantWhileForeground(false)
                }
            }
            .build()

    private var appGraphHolder: AppGraph? = null

    override fun onCreate() {
        super.onCreate()
        observabilityStartup = startAndroidObservability(application = this)
        publishAppGraph(appGraph = createAppGraph())
        observeProcessLifecycle()
    }

    /**
     * Registers the `app_opened`, background-flush and launcher-icon hooks once per process, next
     * to the process-scoped flags in `analytics/AppAnalyticsSupport.kt` that it maintains.
     *
     * It deliberately does not live in the composition. `FlashcardsApp` returns early while startup
     * is loading, when startup failed and while the credential-recovery gate is up, so an observer
     * registered there would be disposed with the flag still saying "foregrounded": a subsequent
     * background would leave `ON_STOP` unobserved, and the next real foreground return would see a
     * stale flag and produce no `app_opened`. It is also not put in `AppGraph`, which is rebuilt
     * several times per instrumentation run and off the main thread, where `addObserver` throws.
     *
     * The process lifecycle rather than the activity one: `ON_START` here fires only when the app
     * actually enters the foreground, and ignores configuration changes and returns from a
     * permission dialog, a photo picker or any other activity, every one of which looks like a warm
     * launch on the activity lifecycle.
     */
    private fun observeProcessLifecycle() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        val appGraph = appGraphOrNull ?: return@LifecycleEventObserver
                        val launchType: AnalyticsLaunchType? = consumeAnalyticsForegroundEntry()
                        if (launchType != null) {
                            appGraph.analytics.track(
                                event = AnalyticsEvent.AppOpened(launchType = launchType)
                            )
                        }
                    }

                    Lifecycle.Event.ON_STOP -> {
                        // Cleared even without a graph, so the flag never outlives the foreground.
                        markAnalyticsProcessBackgrounded()
                        val appGraph = appGraphOrNull ?: return@LifecycleEventObserver
                        appGraph.analytics.flush()
                        appGraph.syncLauncherAppIconInBackground()
                    }

                    else -> Unit
                }
            }
        )
    }

    suspend fun closeAppGraph() {
        appGraphResetMutex.withLock {
            val existingAppGraph = detachAppGraph() ?: return@withLock
            existingAppGraph.close()
        }
    }

    suspend fun recreateAppGraphAndAwaitStartup() {
        appGraphResetMutex.withLock {
            val existingAppGraph = detachAppGraph()
            existingAppGraph?.close()

            val newAppGraph = createAppGraph()
            publishAppGraph(appGraph = newAppGraph)
            newAppGraph.awaitStartup()
        }
    }

    fun shouldKeepSplashScreenVisible(): Boolean {
        val currentAppGraph = appGraphOrNull ?: return true
        return currentAppGraph.startupState.value is AppStartupState.Loading
    }

    /**
     * The single point every reminder tap passes through, whether it launched the process or arrived
     * at a running one, which is why `notification_opened` is reported here rather than at either
     * activity entry point. The extras are cleared as the intent is consumed, so a configuration
     * change that re-delivers the same intent does not report the tap twice.
     */
    fun requestAppNotificationTap(request: AppNotificationTapRequest) {
        appGraphOrNull?.analytics?.track(
            event = AnalyticsEvent.NotificationOpened(
                notificationKind = analyticsNotificationKind(type = request.type)
            )
        )
        appNotificationTapStateMutable.value = AppNotificationTapHandoffRequest(
            requestId = nextAppNotificationTapRequestId.incrementAndGet(),
            request = request
        )
    }

    fun consumeAppNotificationTap(requestId: Long) {
        val currentRequest = appNotificationTapStateMutable.value ?: return
        if (currentRequest.requestId != requestId) {
            return
        }

        appNotificationTapStateMutable.value = null
    }

    private fun publishAppGraph(appGraph: AppGraph) {
        synchronized(appGraphLock) {
            appGraphHolder = appGraph
            appGraphStateMutable.value = appGraph
        }
        enqueueMediaUploadWorker(context = this, initialDelayMillis = 0L)
    }

    private fun createAppGraph(): AppGraph {
        return AppGraph(
            context = this,
            observability = observabilityStartup.observability,
            okHttpClient = observabilityStartup.okHttpClient
        )
    }

    private suspend fun detachAppGraph(): AppGraph? {
        val existingAppGraph = synchronized(appGraphLock) {
            val currentAppGraph = appGraphHolder ?: return null
            appGraphHolder = null
            appGraphStateMutable.value = null
            currentAppGraph
        }

        // Let active lifecycle observers and Compose collectors release the old graph first.
        withContext(Dispatchers.Main.immediate) {
            yield()
        }

        return existingAppGraph
    }
}
