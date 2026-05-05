package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.repository.TimeProvider

internal class ProgressLocalCacheReadinessCoordinator(
    private val localProgressCacheStore: LocalProgressCacheStore,
    private val timeProvider: TimeProvider
) {
    private val localCacheRebuildCoordinator = ProgressLocalCacheRebuildCoordinator()

    suspend fun ensureLocalCacheReady(
        timeZone: String
    ) {
        // If another caller is already rebuilding the cache for this timezone, await its result
        // instead of returning early. Returning early would let a follow-up refresh see
        // isLocalCacheReady = false and silently bail, dropping the user-initiated refresh.
        val lease = localCacheRebuildCoordinator.acquireRebuildLease(timeZone = timeZone)
        when (lease) {
            is ProgressLocalCacheRebuildLease.Waiter -> {
                lease.inFlight.await()
            }
            is ProgressLocalCacheRebuildLease.Owner -> {
                runOwnedLocalCacheRebuild(timeZone = timeZone, lease = lease)
            }
        }
    }

    private suspend fun runOwnedLocalCacheRebuild(
        timeZone: String,
        lease: ProgressLocalCacheRebuildLease.Owner
    ) {
        var failure: Throwable? = null
        try {
            localProgressCacheStore.rebuildTimeZoneCache(
                timeZone = timeZone,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            // completeRebuild is invoked in the finally block so concurrent waiters always
            // observe completion. If the rebuild failed or was cancelled, the same throwable
            // propagates to waiters so they do not silently see an empty cache.
            localCacheRebuildCoordinator.completeRebuild(
                timeZone = timeZone,
                completion = lease.completion,
                error = failure
            )
        }
    }
}
