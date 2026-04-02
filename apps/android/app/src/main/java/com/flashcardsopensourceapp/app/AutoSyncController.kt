package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.AutoSyncSource
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
    private val autoSyncEventRepository: AutoSyncEventRepository
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
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Auto-triggered sync failures stay silent on content surfaces.
            }
        }
    }
}
