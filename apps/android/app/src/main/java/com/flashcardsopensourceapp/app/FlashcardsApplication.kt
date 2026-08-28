package com.flashcardsopensourceapp.app

import android.app.Application
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import com.flashcardsopensourceapp.app.analytics.consumeAnalyticsForegroundEntry
import com.flashcardsopensourceapp.app.analytics.markAnalyticsProcessBackgrounded
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.di.AppStartupState
import com.flashcardsopensourceapp.app.navigation.AppNotificationTapHandoffRequest
import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import com.flashcardsopensourceapp.app.observability.AndroidObservabilityStartup
import com.flashcardsopensourceapp.app.observability.startAndroidObservability
import com.flashcardsopensourceapp.app.runtime.isAndroidRuntimeSupported
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsLaunchType
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private lateinit var observabilityStartup: AndroidObservabilityStartup
    private var runtimeSupported: Boolean = true

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

    val isRuntimeSupported: Boolean
        get() = runtimeSupported

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMaxSchedulerLimit(appNotificationWorkLimit)
            .build()

    private var appGraphHolder: AppGraph? = null

    override fun onCreate() {
        super.onCreate()
        if (isAndroidRuntimeSupported().not()) {
            runtimeSupported = false
            return
        }

        observabilityStartup = startAndroidObservability(application = this)
        publishAppGraph(appGraph = createAppGraph())
        observeProcessLifecycleForAnalytics()
    }

    /**
     * Registers the `app_opened` and background-flush hook once per process, next to the
     * process-scoped flags in `analytics/AppAnalyticsSupport.kt` that it maintains.
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
    private fun observeProcessLifecycleForAnalytics() {
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
        if (runtimeSupported.not()) {
            return false
        }

        val currentAppGraph = appGraphOrNull ?: return true
        return currentAppGraph.startupState.value is AppStartupState.Loading
    }

    fun requestAppNotificationTap(request: AppNotificationTapRequest) {
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
        require(runtimeSupported) {
            "Android runtime is unsupported."
        }

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
