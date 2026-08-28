package com.flashcardsopensourceapp.core.observability.analytics

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

/**
 * How stale a cached reading may get while the callback is unavailable. Only the fallback path uses
 * it; a registered callback keeps the cache current for free.
 */
private const val analyticsNetworkStateRefreshIntervalMillis: Long = 30_000L

/**
 * Reads the network state when an event is created, and reports connectivity coming back so the
 * queue can drain.
 *
 * The reading has to happen at creation time: an offline-first client can only ever flush while
 * online, so a flush-time reading could never record `offline`, which is the one value the column
 * exists for.
 */
class AnalyticsNetworkMonitor(
    context: Context,
    private val scope: CoroutineScope
) : AnalyticsNetworkStateProvider {
    private val connectivityManager: ConnectivityManager? =
        context.applicationContext.getSystemService(ConnectivityManager::class.java)

    @Volatile
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    @Volatile
    private var observedNetworkState: AnalyticsNetworkState = AnalyticsNetworkState.UNKNOWN

    private val isRefreshInFlight = AtomicBoolean(false)

    /**
     * `null` until a reading has actually been taken. A zero sentinel would collide with the first
     * [analyticsNetworkStateRefreshIntervalMillis] of uptime, where `elapsedRealtime` is itself
     * still below the interval, and swallow the only reading an offline launch ever gets.
     */
    @Volatile
    private var lastRefreshAtElapsedMillis: Long? = null

    /**
     * Answers from the cache and never from the binder. Most call sites are on the main thread, and
     * `ConnectivityManager.activeNetwork` plus `getNetworkCapabilities` are two binder round trips —
     * exactly the blocking of a tap this module forbids — so registration failing must not turn
     * every `track` into them. It refreshes the cache off this thread instead.
     *
     * Until a reading has landed the answer is `unknown`, which is legal and honest. `offline` is
     * never synthesised from a state that was not observed: it is the one value the per-event field
     * exists to carry, and a false one poisons exactly the analysis it was added for.
     */
    override fun currentNetworkState(): AnalyticsNetworkState {
        if (networkCallback == null) {
            requestNetworkStateRefresh()
        }
        return observedNetworkState
    }

    /**
     * Reads the state on the IO dispatcher, at most once per
     * [analyticsNetworkStateRefreshIntervalMillis] and never twice at a time, so a burst of events
     * costs the caller one atomic compare and nothing else. `elapsedRealtime` rather than wall time:
     * a clock correction must not stall the refresh for the size of the jump. The throttle never
     * suppresses the first read, whenever in the device's uptime it is asked for.
     */
    private fun requestNetworkStateRefresh() {
        val nowElapsedMillis: Long = SystemClock.elapsedRealtime()
        val lastRefreshMillis: Long? = lastRefreshAtElapsedMillis
        if (
            lastRefreshMillis != null &&
            nowElapsedMillis - lastRefreshMillis < analyticsNetworkStateRefreshIntervalMillis
        ) {
            return
        }
        if (isRefreshInFlight.compareAndSet(false, true).not()) {
            return
        }

        scope.launch(Dispatchers.IO) {
            try {
                observedNetworkState = readNetworkState()
                lastRefreshAtElapsedMillis = SystemClock.elapsedRealtime()
            } finally {
                isRefreshInFlight.set(false)
            }
        }
    }

    private fun readNetworkState(): AnalyticsNetworkState {
        val manager: ConnectivityManager = connectivityManager ?: return AnalyticsNetworkState.UNKNOWN
        return try {
            val activeNetwork: Network = manager.activeNetwork ?: return AnalyticsNetworkState.OFFLINE
            val capabilities: NetworkCapabilities = manager.getNetworkCapabilities(activeNetwork)
                ?: return AnalyticsNetworkState.OFFLINE
            networkStateFor(capabilities = capabilities)
        } catch (_: SecurityException) {
            AnalyticsNetworkState.UNKNOWN
        }
    }

    fun startObservingConnectivityRestored(onConnectivityRestored: () -> Unit) {
        val manager: ConnectivityManager = connectivityManager ?: return
        if (networkCallback != null) {
            return
        }

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                observedNetworkState = readNetworkState()
                onConnectivityRestored()
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                observedNetworkState = networkStateFor(capabilities = networkCapabilities)
            }

            override fun onLost(network: Network) {
                observedNetworkState = readNetworkState()
            }

            override fun onUnavailable() {
                observedNetworkState = AnalyticsNetworkState.OFFLINE
            }
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: SecurityException) {
            // Without the network-state permission the queue still drains on its periodic timer,
            // and `currentNetworkState` falls back to its own throttled background refresh.
        } catch (_: IllegalArgumentException) {
            // Nothing to observe on this device; the periodic timer remains the flush trigger.
        }

        // Seeded off this thread — registration happens during graph construction on the main
        // thread. Registration alone is not enough: it replays the current default network
        // asynchronously, but replays nothing at all when there is no network, so an app launched
        // offline would report `unknown` instead of the `offline` it can actually observe.
        requestNetworkStateRefresh()
    }

    fun stopObservingConnectivityRestored() {
        val manager: ConnectivityManager = connectivityManager ?: return
        val callback: ConnectivityManager.NetworkCallback = networkCallback ?: return
        networkCallback = null
        try {
            manager.unregisterNetworkCallback(callback)
        } catch (_: IllegalArgumentException) {
            // Already unregistered.
        }
    }
}

private fun networkStateFor(capabilities: NetworkCapabilities): AnalyticsNetworkState {
    return when {
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).not() ->
            AnalyticsNetworkState.OFFLINE
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> AnalyticsNetworkState.WIFI
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> AnalyticsNetworkState.CELLULAR
        else -> AnalyticsNetworkState.UNKNOWN
    }
}
