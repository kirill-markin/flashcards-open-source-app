package com.flashcardsopensourceapp.data.local.repository

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

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

internal class ProgressLocalCacheRebuildCoordinator {
    private val rebuildMutex = Mutex()
    private val rebuildingTimeZones = mutableSetOf<String>()

    suspend fun beginRebuild(timeZone: String): Boolean {
        return rebuildMutex.withLock {
            rebuildingTimeZones.add(timeZone)
        }
    }

    suspend fun endRebuild(timeZone: String) {
        rebuildMutex.withLock {
            rebuildingTimeZones.remove(timeZone)
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
