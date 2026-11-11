package com.flashcardsopensourceapp.data.local.cloud.sync

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.coroutineContext

private const val pendingGuestUpgradeLocalOutboxBlockReason: String =
    "Guest upgrade recovery is pending. Wait for account linking recovery to finish before changing cards."

private object LocalOutboxMutationContextKey : CoroutineContext.Key<LocalOutboxMutationContextElement>

private class LocalOutboxMutationContextElement :
    AbstractCoroutineContextElement(LocalOutboxMutationContextKey)

private fun completedUnitSignal(): CompletableDeferred<Unit> {
    val signal: CompletableDeferred<Unit> = CompletableDeferred()
    signal.complete(Unit)
    return signal
}

class LocalOutboxWritesBlockedException(message: String) : IllegalStateException(message)

internal class LocalOutboxWriteGate(
    private val hasPendingGuestUpgrade: suspend () -> Boolean
) {
    private val mutex = Mutex()
    private var localOutboxWriteBlockReason: String? = null
    private var activeLocalOutboxMutationTransactions: Int = 0
    private var localOutboxMutationTransactionsDrained: CompletableDeferred<Unit> = completedUnitSignal()

    suspend fun <Result> runWithLocalOutboxWritesBlocked(
        reason: String,
        block: suspend () -> Result
    ): Result {
        val transactionsDrained = activateLocalOutboxWriteBlock(reason = reason)
        try {
            transactionsDrained.await()
            return block()
        } finally {
            withContext(NonCancellable) { clearLocalOutboxWriteBlock() }
        }
    }

    suspend fun <Result> runWithLocalOutboxMutationAllowed(block: suspend () -> Result): Result {
        beginLocalOutboxMutationTransaction()
        try {
            return withContext(LocalOutboxMutationContextElement()) {
                block()
            }
        } finally {
            withContext(NonCancellable) { finishLocalOutboxMutationTransaction() }
        }
    }

    suspend fun <Result> runWithLocalOutboxWritesAllowed(block: suspend () -> Result): Result {
        if (isLocalOutboxMutationTransactionActive()) {
            return block()
        }

        mutex.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            return block()
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun activateLocalOutboxWriteBlock(reason: String): CompletableDeferred<Unit> {
        mutex.lock()
        try {
            check(localOutboxWriteBlockReason == null) {
                "Local outbox writes are already blocked. Existing reason='$localOutboxWriteBlockReason'"
            }
            check(hasPendingGuestUpgrade().not()) {
                pendingGuestUpgradeLocalOutboxBlockReason
            }
            localOutboxWriteBlockReason = reason
            return localOutboxMutationTransactionsDrained
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun clearLocalOutboxWriteBlock() {
        mutex.lock()
        try {
            localOutboxWriteBlockReason = null
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun beginLocalOutboxMutationTransaction() {
        mutex.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained = CompletableDeferred()
            }
            activeLocalOutboxMutationTransactions += 1
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun finishLocalOutboxMutationTransaction() {
        mutex.lock()
        try {
            check(activeLocalOutboxMutationTransactions > 0) {
                "Local outbox mutation transaction finished without a matching start."
            }
            activeLocalOutboxMutationTransactions -= 1
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained.complete(Unit)
            }
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun isLocalOutboxMutationTransactionActive(): Boolean {
        return coroutineContext[LocalOutboxMutationContextKey] != null
    }

    private suspend fun requireLocalOutboxWritesAllowedLocked() {
        if (hasPendingGuestUpgrade()) {
            throw IllegalStateException(pendingGuestUpgradeLocalOutboxBlockReason)
        }
        val blockedReason = localOutboxWriteBlockReason ?: return
        throw LocalOutboxWritesBlockedException(blockedReason)
    }
}
