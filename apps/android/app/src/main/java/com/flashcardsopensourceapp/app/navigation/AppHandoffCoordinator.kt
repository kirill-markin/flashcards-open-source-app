package com.flashcardsopensourceapp.app.navigation

import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AiEntryPrefillRequest(
    val requestId: Long,
    val prefill: AiEntryPrefill
)

class AppHandoffCoordinator {
    private val nextRequestId = AtomicLong(0L)
    private val aiEntryPrefillState = MutableStateFlow<AiEntryPrefillRequest?>(value = null)

    fun observeAiEntryPrefill(): StateFlow<AiEntryPrefillRequest?> {
        return aiEntryPrefillState.asStateFlow()
    }

    fun requestAiEntryPrefill(prefill: AiEntryPrefill) {
        aiEntryPrefillState.value = AiEntryPrefillRequest(
            requestId = nextRequestId.incrementAndGet(),
            prefill = prefill
        )
    }

    fun consumeAiEntryPrefill(requestId: Long) {
        if (aiEntryPrefillState.value?.requestId != requestId) {
            return
        }

        aiEntryPrefillState.value = null
    }
}
