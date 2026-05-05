package com.flashcardsopensourceapp.data.local.repository.cloudsync

import kotlinx.coroutines.sync.Mutex

/**
 * Android foreground sync and workspace/account mutations share one process and
 * one local database. Serialize them so a background sync cannot observe stale
 * cloud settings while a workspace switch is replacing the local shell.
 */
class CloudOperationCoordinator {
    private val mutex = Mutex()

    suspend fun <Result> runExclusive(block: suspend () -> Result): Result {
        mutex.lock()
        try {
            return block()
        } finally {
            mutex.unlock()
        }
    }
}
