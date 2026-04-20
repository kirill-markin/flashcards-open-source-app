package com.flashcardsopensourceapp.app

import android.app.Application
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.di.AppStartupState
import com.flashcardsopensourceapp.app.navigation.AppNotificationTapHandoffRequest
import com.flashcardsopensourceapp.app.notifications.AppNotificationTapRequest
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield

class FlashcardsApplication : Application() {
    private val appGraphResetMutex = Mutex()
    private val appGraphLock = Any()
    private val nextAppNotificationTapRequestId = AtomicLong(0L)
    private val appGraphStateMutable = MutableStateFlow<AppGraph?>(value = null)
    private val appNotificationTapStateMutable = MutableStateFlow<AppNotificationTapHandoffRequest?>(value = null)

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

    private var appGraphHolder: AppGraph? = null

    override fun onCreate() {
        super.onCreate()
        publishAppGraph(appGraph = AppGraph(context = this))
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

            val newAppGraph = AppGraph(context = this)
            publishAppGraph(appGraph = newAppGraph)
            newAppGraph.awaitStartup()
        }
    }

    fun shouldKeepSplashScreenVisible(): Boolean {
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
