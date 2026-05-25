package com.flashcardsopensourceapp.data.local.repository.cloudsync

import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext

/**
 * Android foreground sync and workspace/account mutations share one process and
 * one local database. Serialize them so a background sync cannot observe stale
 * cloud settings while a workspace switch is replacing the local shell.
 */
class CloudOperationCoordinator {
    private val mutex = Mutex()

    suspend fun <Result> runExclusive(block: suspend () -> Result): Result {
        val currentOperationContext: CloudOperationContextElement? = currentCoroutineContext()[CloudOperationContextKey]
        if (currentOperationContext?.contains(coordinator = this) == true) {
            return block()
        }

        mutex.lock()
        try {
            val currentLockedCoordinators: Set<CloudOperationCoordinator> =
                currentOperationContext?.lockedCoordinators ?: emptySet()
            val lockedCoordinators: Set<CloudOperationCoordinator> =
                currentLockedCoordinators + this
            return withContext(CloudOperationContextElement(lockedCoordinators = lockedCoordinators)) {
                block()
            }
        } finally {
            mutex.unlock()
        }
    }

    suspend fun requireExclusiveOperation(operationName: String) {
        require(isRunningExclusive()) {
            "$operationName requires CloudOperationCoordinator.runExclusive."
        }
    }

    private suspend fun isRunningExclusive(): Boolean {
        return currentCoroutineContext()[CloudOperationContextKey]?.contains(coordinator = this) == true
    }
}

private class CloudOperationContextElement(
    val lockedCoordinators: Set<CloudOperationCoordinator>
) : CoroutineContext.Element {
    override val key: CoroutineContext.Key<CloudOperationContextElement> = CloudOperationContextKey

    fun contains(coordinator: CloudOperationCoordinator): Boolean {
        return lockedCoordinators.contains(coordinator)
    }
}

private object CloudOperationContextKey : CoroutineContext.Key<CloudOperationContextElement>
