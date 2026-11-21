package com.flashcardsopensourceapp.data.local.ai.store

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

private data class AiChatCustomInstructionsReading(
    val observedAt: Long,
    val customInstructions: String?
)

/** The newest known custom chat instructions per account+workspace scope, kept in memory because edits are online-only. */
class AiChatCustomInstructionsStore {
    private val clock = AtomicLong(0L)
    private val readings = MutableStateFlow<Map<String, AiChatCustomInstructionsReading>>(value = emptyMap())

    /** A read is stamped when its request starts and a save when it completes, so a save beats any read that started before it. */
    fun stamp(): Long {
        return clock.incrementAndGet()
    }

    fun record(scopeId: String, observedAt: Long, customInstructions: String?) {
        readings.update { current ->
            val existing = current[scopeId]
            if (existing != null && existing.observedAt >= observedAt) {
                current
            } else {
                current + (scopeId to AiChatCustomInstructionsReading(
                    observedAt = observedAt,
                    customInstructions = customInstructions
                ))
            }
        }
    }

    /** Null while the scope is unset or not loaded yet. */
    fun observe(scopeId: String): Flow<String?> {
        return readings
            .map { current -> current[scopeId]?.customInstructions }
            .distinctUntilChanged()
    }
}
