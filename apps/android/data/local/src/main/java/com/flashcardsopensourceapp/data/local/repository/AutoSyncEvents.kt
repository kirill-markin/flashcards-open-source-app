package com.flashcardsopensourceapp.data.local.repository

import kotlinx.coroutines.flow.Flow

enum class AutoSyncSource {
    APP_LAUNCH,
    APP_FOREGROUND,
    REVIEW_TAB_SELECTED,
    CARDS_TAB_SELECTED
}

data class AutoSyncRequest(
    val requestId: String,
    val source: AutoSyncSource,
    val triggeredAtMillis: Long,
    val shouldExtendPolling: Boolean,
    val allowsVisibleChangeMessage: Boolean
)

sealed interface AutoSyncOutcome {
    data object Succeeded : AutoSyncOutcome

    data class Failed(
        val message: String
    ) : AutoSyncOutcome
}

data class AutoSyncCompletion(
    val request: AutoSyncRequest,
    val completedAtMillis: Long,
    val outcome: AutoSyncOutcome
)

sealed interface AutoSyncEvent {
    data class Requested(
        val request: AutoSyncRequest
    ) : AutoSyncEvent

    data class Completed(
        val completion: AutoSyncCompletion
    ) : AutoSyncEvent
}

interface AutoSyncEventRepository {
    fun observeAutoSyncEvents(): Flow<AutoSyncEvent>
    suspend fun runAutoSync(request: AutoSyncRequest)
}
