package com.flashcardsopensourceapp.data.local.repository.progress

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal enum class ProgressRemoteRefreshSyncMode {
    SKIP_SYNC,
    SYNC_BEFORE_REMOTE_LOAD
}

internal class ProgressRefreshCoordinator {
    private val refreshScopesMutex = Mutex()
    private val refreshingScopeKeys = mutableSetOf<String>()
    private val queuedRefreshSyncModes = mutableMapOf<String, ProgressRemoteRefreshSyncMode>()

    suspend fun beginRefresh(
        scopeKey: String,
        syncMode: ProgressRemoteRefreshSyncMode
    ): Boolean {
        return refreshScopesMutex.withLock {
            if (refreshingScopeKeys.add(scopeKey)) {
                return@withLock true
            }

            val queuedSyncMode = queuedRefreshSyncModes[scopeKey] ?: ProgressRemoteRefreshSyncMode.SKIP_SYNC
            queuedRefreshSyncModes[scopeKey] = mergeProgressRemoteRefreshSyncMode(
                first = queuedSyncMode,
                second = syncMode
            )
            false
        }
    }

    suspend fun completeRefreshIteration(
        scopeKey: String
    ): ProgressRemoteRefreshSyncMode? {
        return refreshScopesMutex.withLock {
            val queuedSyncMode = queuedRefreshSyncModes.remove(scopeKey)
            if (queuedSyncMode != null) {
                return@withLock queuedSyncMode
            }

            refreshingScopeKeys.remove(scopeKey)
            null
        }
    }

    suspend fun endRefresh(
        scopeKey: String
    ) {
        refreshScopesMutex.withLock {
            refreshingScopeKeys.remove(scopeKey)
            queuedRefreshSyncModes.remove(scopeKey)
        }
    }
}

internal sealed class ProgressLocalCacheRebuildLease {
    // The current caller owns the rebuild and must run it, then call completeRebuild.
    internal data class Owner(
        val completion: CompletableDeferred<Unit>
    ) : ProgressLocalCacheRebuildLease()

    // Another caller is rebuilding for this timezone. The current caller must await this Deferred.
    // Awaiting propagates failure and cancellation from the in-flight rebuild instead of silently
    // returning an unfinished cache state.
    internal data class Waiter(
        val inFlight: CompletableDeferred<Unit>
    ) : ProgressLocalCacheRebuildLease()
}

internal class ProgressLocalCacheRebuildCoordinator {
    private val rebuildMutex = Mutex()
    private val inFlightRebuildsByTimeZone = mutableMapOf<String, CompletableDeferred<Unit>>()

    // Acquire a lease for a timezone-scoped local cache rebuild.
    // If no rebuild is in flight, the caller becomes the Owner and is responsible for running
    // the rebuild and signalling completion via completeRebuild. Otherwise the caller becomes
    // a Waiter and must await the returned Deferred so the same logical refresh that the
    // first caller started is observed instead of being silently dropped.
    suspend fun acquireRebuildLease(timeZone: String): ProgressLocalCacheRebuildLease {
        return rebuildMutex.withLock {
            val existing = inFlightRebuildsByTimeZone[timeZone]
            if (existing != null) {
                return@withLock ProgressLocalCacheRebuildLease.Waiter(inFlight = existing)
            }

            val completion = CompletableDeferred<Unit>()
            inFlightRebuildsByTimeZone[timeZone] = completion
            ProgressLocalCacheRebuildLease.Owner(completion = completion)
        }
    }

    // Release the lease for a timezone and signal the awaited Deferred so any concurrent
    // waiters resume. The owner must call this exactly once per Owner lease, even on failure
    // or cancellation, otherwise waiters will block indefinitely. The map cleanup runs under
    // NonCancellable so a cancelled owner still releases the slot for follow-up callers.
    suspend fun completeRebuild(
        timeZone: String,
        completion: CompletableDeferred<Unit>,
        error: Throwable?
    ) {
        withContext(NonCancellable) {
            rebuildMutex.withLock {
                val tracked = inFlightRebuildsByTimeZone[timeZone]
                if (tracked === completion) {
                    inFlightRebuildsByTimeZone.remove(timeZone)
                }
            }
        }
        if (error != null) {
            completion.completeExceptionally(error)
        } else {
            completion.complete(Unit)
        }
    }
}

private fun mergeProgressRemoteRefreshSyncMode(
    first: ProgressRemoteRefreshSyncMode,
    second: ProgressRemoteRefreshSyncMode
): ProgressRemoteRefreshSyncMode {
    return if (
        first == ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD ||
        second == ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD
    ) {
        ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD
    } else {
        ProgressRemoteRefreshSyncMode.SKIP_SYNC
    }
}
