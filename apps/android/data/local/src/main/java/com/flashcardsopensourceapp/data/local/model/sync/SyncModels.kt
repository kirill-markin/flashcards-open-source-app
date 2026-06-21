package com.flashcardsopensourceapp.data.local.model.sync

import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary

enum class SyncEntityType {
    CARD,
    DECK,
    WORKSPACE_SCHEDULER_SETTINGS,
    REVIEW_EVENT
}

enum class SyncAction {
    UPSERT,
    APPEND
}

sealed interface SyncStatus {
    data object Idle : SyncStatus

    data object Syncing : SyncStatus

    data class Blocked(
        val message: String,
        val installationId: String
    ) : SyncStatus

    data class Failed(
        val message: String
    ) : SyncStatus
}

data class SyncStatusSnapshot(
    val status: SyncStatus,
    val lastSuccessfulSyncAtMillis: Long?,
    val lastErrorMessage: String
)

data class AccountPreferences(
    val reviewReactionAnimationsEnabled: Boolean
)

fun defaultAccountPreferences(): AccountPreferences {
    return AccountPreferences(reviewReactionAnimationsEnabled = true)
}

data class CloudAccountSnapshot(
    val userId: String,
    val email: String?,
    val preferences: AccountPreferences,
    val workspaces: List<CloudWorkspaceSummary>
)

data class CardSyncPayload(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    // TODO: Remove legacy effortLevel once the backend wire contract drops it.
    val effortLevel: String,
    val dueAt: String?,
    val createdAt: String,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: String,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAt: String?,
    val fsrsScheduledDays: Int?,
    val deletedAt: String?
)

data class DeckSyncPayload(
    val deckId: String,
    val name: String,
    val filterDefinition: DeckFilterDefinition,
    val createdAt: String,
    val deletedAt: String?
)

data class WorkspaceSchedulerSettingsSyncPayload(
    val algorithm: String,
    val desiredRetention: Double,
    val learningStepsMinutes: List<Int>,
    val relearningStepsMinutes: List<Int>,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean
)

data class ReviewEventSyncPayload(
    val reviewEventId: String,
    val cardId: String,
    val clientEventId: String,
    val rating: Int,
    val reviewedAtClient: String,
    val reviewedTimeZone: String?
)

sealed interface SyncOperationPayload {
    data class Card(
        val payload: CardSyncPayload
    ) : SyncOperationPayload

    data class Deck(
        val payload: DeckSyncPayload
    ) : SyncOperationPayload

    data class WorkspaceSchedulerSettings(
        val payload: WorkspaceSchedulerSettingsSyncPayload
    ) : SyncOperationPayload

    data class ReviewEvent(
        val payload: ReviewEventSyncPayload
    ) : SyncOperationPayload
}

data class SyncOperation(
    val operationId: String,
    val entityType: SyncEntityType,
    val entityId: String,
    val action: SyncAction,
    val clientUpdatedAt: String,
    val payload: SyncOperationPayload
)

data class PersistedOutboxEntry(
    val operationId: String,
    val workspaceId: String,
    val createdAtMillis: Long,
    val attemptCount: Int,
    val lastError: String,
    val operation: SyncOperation
)

enum class AppMetadataStorage {
    ROOM_SQLITE
}

sealed interface AppMetadataSyncStatus {
    data object NotConnected : AppMetadataSyncStatus

    data object SignInCompleteChooseWorkspace : AppMetadataSyncStatus

    data object GuestAiSession : AppMetadataSyncStatus

    data object Synced : AppMetadataSyncStatus

    data object Syncing : AppMetadataSyncStatus

    data class Message(
        val text: String
    ) : AppMetadataSyncStatus
}

data class AppMetadataSummary(
    val currentWorkspaceName: String?,
    val workspaceName: String?,
    val deckCount: Int,
    val cardCount: Int,
    val localStorage: AppMetadataStorage,
    val syncStatus: AppMetadataSyncStatus
)

data class DeviceDiagnosticsSummary(
    val workspaceId: String,
    val workspaceName: String,
    val outboxEntriesCount: Int,
    val lastSyncCursor: String?,
    val lastSyncAttemptAtMillis: Long?,
    val lastSuccessfulSyncAtMillis: Long?,
    val lastSyncErrorMessage: String?
)
