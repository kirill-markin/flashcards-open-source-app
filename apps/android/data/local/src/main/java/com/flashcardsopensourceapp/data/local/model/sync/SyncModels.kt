package com.flashcardsopensourceapp.data.local.model.sync

import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.cards.CardMetadata
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary

enum class SyncEntityType {
    CARD,
    DECK,
    WORKSPACE_SCHEDULER_SETTINGS,
    MEDIA_ASSET,
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
    val reviewReactionAnimationsEnabled: Boolean,
    /**
     * The product-analytics off switch. Null is "nobody answered", which reads as on: the basis is
     * legitimate interest and nothing prompts for it, so only an explicit false opts out.
     */
    val productAnalyticsEnabled: Boolean?
)

/**
 * Who asked for the analytics value beside it in one `PATCH /v1/me/preferences`.
 *
 * [USER_ACTION] is the person pressing the control on this device, now, with the control still
 * waiting on the result. [RECONCILIATION] is this device carrying over an answer it has been
 * holding, given at a time nothing in the request records and possibly for another identity.
 *
 * The route refuses a [RECONCILIATION] that would loosen a stored refusal and answers with the
 * stored value instead, so a remembered opt-in cannot revert an opt-out taken since on another
 * device. A [USER_ACTION] is always stored, which is what keeps the switch reversible by the
 * control that moved it. An omitted origin means `user_action` on the route, which is what every
 * client sent before the field existed.
 */
enum class AnalyticsPreferenceWriteOrigin(val wireValue: String) {
    USER_ACTION("user_action"),
    RECONCILIATION("reconciliation")
}

/** Mirrors `PATCH /v1/me/preferences`: a null field is one this update leaves alone. */
data class AccountPreferencesUpdate(
    val reviewReactionAnimationsEnabled: Boolean?,
    val productAnalyticsEnabled: Boolean?,
    /**
     * Who asked for [productAnalyticsEnabled]. Null leaves the route's `user_action` default, which
     * is what the controls a person presses want, so only a carried-over answer names it.
     */
    val productAnalyticsEnabledOrigin: AnalyticsPreferenceWriteOrigin? = null
)

fun defaultAccountPreferences(): AccountPreferences {
    return AccountPreferences(
        reviewReactionAnimationsEnabled = true,
        productAnalyticsEnabled = null
    )
}

fun isProductAnalyticsEnabled(preferences: AccountPreferences): Boolean {
    return preferences.productAnalyticsEnabled != false
}

fun applyAccountPreferencesUpdate(
    preferences: AccountPreferences,
    update: AccountPreferencesUpdate
): AccountPreferences {
    return AccountPreferences(
        reviewReactionAnimationsEnabled = update.reviewReactionAnimationsEnabled
            ?: preferences.reviewReactionAnimationsEnabled,
        productAnalyticsEnabled = update.productAnalyticsEnabled ?: preferences.productAnalyticsEnabled
    )
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
    val cardType: String,
    val metadata: CardMetadata,
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

data class MediaAssetSyncPayload(
    val mediaAssetId: String,
    val workspaceId: String,
    val mimeType: String,
    val sizeBytes: Long,
    val sha256: String,
    val sourceUrl: String?,
    val createdAt: String,
    val deletedAt: String?
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

    data class MediaAsset(
        val payload: MediaAssetSyncPayload
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

data class LocalSyncDiagnosticsSummary(
    val cardsSync: LocalSyncDiagnosticsCardsSync,
    val managedMediaSync: LocalSyncDiagnosticsManagedMediaSync,
    val problemRecords: LocalSyncDiagnosticsProblemRecords
)

data class LocalSyncDiagnosticsCardsSync(
    val workspaceId: String,
    val installationId: String,
    val cloudState: CloudAccountState,
    val localActiveCards: Int,
    val localDeletedCards: Int,
    val pendingCardOperations: Int,
    val failedCardOperations: Int,
    val oldestPendingCardOperationAtMillis: Long?,
    val latestCardSyncSuccessAtMillis: Long?,
    val hotStateHydrated: Boolean,
    val hotCursor: String?,
    val reviewCursor: Long?,
    val latestSyncError: String?
)

data class LocalSyncDiagnosticsManagedMediaSync(
    val localActiveMediaAssets: Int,
    val deletedMediaAssets: Int,
    val localMediaBlobs: Int,
    val localMediaBytes: Long,
    val referencedMediaInCards: Int,
    val referencesMissingLocalAsset: Int,
    val assetsMissingLocalBlob: Int,
    val pendingMediaUploads: Int,
    val failedMediaUploads: Int,
    val pendingMediaDownloads: Int?,
    val failedMediaDownloads: Int?,
    val oldestPendingMediaTransferAtMillis: Long?,
    val latestMediaUploadSuccessAtMillis: Long?,
    val latestMediaDownloadCacheSuccessAtMillis: Long?,
    val latestMediaTransferError: String?
)

data class LocalSyncDiagnosticsProblemRecords(
    val failedCardOutboxEntries: List<LocalSyncDiagnosticsCardOutboxProblem>,
    val failedMediaTransfers: List<LocalSyncDiagnosticsMediaTransferProblem>,
    val missingMediaReferences: List<LocalSyncDiagnosticsMissingMediaReferenceProblem>,
    val assetsMissingLocalBlob: List<LocalSyncDiagnosticsMissingMediaBlobProblem>
)

data class LocalSyncDiagnosticsCardOutboxProblem(
    val operationId: String,
    val cardId: String,
    val createdAtMillis: Long,
    val attemptCount: Int,
    val lastError: String?
)

data class LocalSyncDiagnosticsMediaTransferProblem(
    val transferId: String,
    val mediaAssetId: String,
    val kind: String,
    val status: String,
    val createdAtMillis: Long,
    val attemptCount: Int,
    val lastError: String?
)

data class LocalSyncDiagnosticsMissingMediaReferenceProblem(
    val cardId: String,
    val mediaAssetId: String
)

data class LocalSyncDiagnosticsMissingMediaBlobProblem(
    val mediaAssetId: String,
    val sha256: String
)
