package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncSource
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val immediateAutoSyncDebounceWindowMillis: Long = 1_000L

class AutoSyncController(
    private val appScope: CoroutineScope,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val reportSyncFailure: (Throwable) -> Unit = {},
    private val reportSyncSucceeded: () -> Unit = {}
) {
    private val pollingResetState = MutableStateFlow(value = 0L)
    private var lastImmediateAutoSyncTriggerAtMillis: Long? = null

    fun observePollingResetAtMillis(): StateFlow<Long> {
        return pollingResetState.asStateFlow()
    }

    fun triggerImmediateAutoSync(
        source: AutoSyncSource,
        currentTimeMillis: Long,
        shouldExtendPolling: Boolean,
        allowsVisibleChangeMessage: Boolean
    ) {
        if (shouldExtendPolling) {
            pollingResetState.value = currentTimeMillis
        }

        val lastTriggerAtMillis = lastImmediateAutoSyncTriggerAtMillis
        if (
            lastTriggerAtMillis != null &&
            currentTimeMillis - lastTriggerAtMillis < immediateAutoSyncDebounceWindowMillis
        ) {
            return
        }
        lastImmediateAutoSyncTriggerAtMillis = currentTimeMillis

        val request = AutoSyncRequest(
            requestId = UUID.randomUUID().toString(),
            source = source,
            triggeredAtMillis = currentTimeMillis,
            shouldExtendPolling = shouldExtendPolling,
            allowsVisibleChangeMessage = allowsVisibleChangeMessage
        )

        appScope.launch {
            try {
                autoSyncEventRepository.runAutoSync(request = request)
                // Re-arms the next failure, so `sync_failed` keeps measuring failure episodes
                // rather than how often the app happens to retry.
                reportSyncSucceeded()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // Auto-triggered sync failures stay silent on content surfaces, but they are still
                // counted: reporting is fire-and-forget and never changes what the user sees.
                reportSyncFailure(error)
            }
        }
    }
}
