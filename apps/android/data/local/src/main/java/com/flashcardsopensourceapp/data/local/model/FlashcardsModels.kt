package com.flashcardsopensourceapp.data.local.model

/*
 Keep these shared data contracts aligned with:
 - apps/web/src/types.ts
 - apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift
 */

data class WorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

enum class CloudAccountState {
    DISCONNECTED,
    LINKING_READY,
    GUEST,
    LINKED
}

enum class CloudServiceConfigurationMode {
    OFFICIAL,
    CUSTOM
}

data class CloudServiceConfiguration(
    val mode: CloudServiceConfigurationMode,
    val customOrigin: String?,
    val apiBaseUrl: String,
    val authBaseUrl: String
)

data class CloudServerOverride(
    val customOrigin: String
)

data class CloudOtpChallenge(
    val email: String,
    val csrfToken: String,
    val otpSessionToken: String
)

data class StoredCloudCredentials(
    val refreshToken: String,
    val idToken: String,
    val idTokenExpiresAtMillis: Long
)

data class CloudIdentityToken(
    val idToken: String,
    val idTokenExpiresAtMillis: Long
)

sealed interface CloudSendCodeResult {
    data class OtpRequired(
        val challenge: CloudOtpChallenge
    ) : CloudSendCodeResult

    data class Verified(
        val credentials: StoredCloudCredentials
    ) : CloudSendCodeResult
}

data class CloudWorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long,
    val isSelected: Boolean
)

enum class CloudGuestUpgradeMode {
    BOUND,
    MERGE_REQUIRED
}

enum class CloudGuestUpgradeDroppedEntityType {
    CARD,
    DECK,
    REVIEW_EVENT
}

data class CloudGuestUpgradeDroppedEntity(
    val entityType: CloudGuestUpgradeDroppedEntityType,
    val entityId: String
)

data class CloudGuestUpgradeReconciliation(
    val droppedEntities: List<CloudGuestUpgradeDroppedEntity>
)

data class CloudGuestUpgradeCompletion(
    val workspace: CloudWorkspaceSummary,
    val reconciliation: CloudGuestUpgradeReconciliation?
)

sealed interface CloudGuestUpgradeSelection {
    data class Existing(
        val workspaceId: String
    ) : CloudGuestUpgradeSelection

    data object CreateNew : CloudGuestUpgradeSelection
}

data class CloudWorkspaceDeletePreview(
    val workspaceId: String,
    val workspaceName: String,
    val activeCardCount: Int,
    val confirmationText: String,
    val isLastAccessibleWorkspace: Boolean
)

data class CloudWorkspaceDeleteResult(
    val ok: Boolean,
    val deletedWorkspaceId: String,
    val deletedCardsCount: Int,
    val workspace: CloudWorkspaceSummary
)

data class CloudWorkspaceResetProgressPreview(
    val workspaceId: String,
    val workspaceName: String,
    val cardsToResetCount: Int,
    val confirmationText: String
)

data class CloudWorkspaceResetProgressResult(
    val ok: Boolean,
    val workspaceId: String,
    val cardsResetCount: Int
)

data class CloudDailyReviewPoint(
    val date: String,
    val reviewCount: Int
)

data class CloudProgressSummary(
    val currentStreakDays: Int,
    val hasReviewedToday: Boolean,
    val lastReviewedOn: String?,
    val activeReviewDays: Int
)

data class CloudProgressSeries(
    val timeZone: String,
    val from: String,
    val to: String,
    val dailyReviews: List<CloudDailyReviewPoint>,
    val generatedAt: String?,
    val summary: CloudProgressSummary?
)

data class AgentApiKeyConnection(
    val connectionId: String,
    val label: String,
    val createdAtMillis: Long,
    val lastUsedAtMillis: Long?,
    val revokedAtMillis: Long?
)

data class AgentApiKeyConnectionsResult(
    val connections: List<AgentApiKeyConnection>,
    val instructions: String
)

sealed interface CloudWorkspaceLinkSelection {
    data class Existing(
        val workspaceId: String
    ) : CloudWorkspaceLinkSelection

    data object CreateNew : CloudWorkspaceLinkSelection
}

data class CloudWorkspaceLinkContext(
    val userId: String,
    val email: String?,
    val credentials: StoredCloudCredentials,
    val workspaces: List<CloudWorkspaceSummary>,
    val guestUpgradeMode: CloudGuestUpgradeMode?,
    val preferredWorkspaceId: String?
)

data class CloudSettings(
    val installationId: String,
    val cloudState: CloudAccountState,
    val linkedUserId: String?,
    val linkedWorkspaceId: String?,
    val linkedEmail: String?,
    val activeWorkspaceId: String?,
    val updatedAtMillis: Long
)

sealed interface AccountDeletionState {
    data object Hidden : AccountDeletionState

    data object InProgress : AccountDeletionState

    data class Failed(
        val message: String
    ) : AccountDeletionState
}

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

data class CloudAccountSnapshot(
    val userId: String,
    val email: String?,
    val workspaces: List<CloudWorkspaceSummary>
)

data class CardSyncPayload(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
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
    val reviewedAtClient: String
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

// Keep in sync with apps/backend/src/schedule.ts::FsrsCardState, apps/web/src/types.ts::FsrsCardState, and apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::FsrsCardState.
enum class FsrsCardState {
    NEW,
    LEARNING,
    REVIEW,
    RELEARNING
}

enum class EffortLevel {
    FAST,
    MEDIUM,
    LONG
}

data class DeckFilterDefinition(
    val version: Int,
    val effortLevels: List<EffortLevel>,
    val tags: List<String>
)

data class DeckDraft(
    val name: String,
    val filterDefinition: DeckFilterDefinition
)

data class DeckSummary(
    val deckId: String,
    val workspaceId: String,
    val name: String,
    val filterDefinition: DeckFilterDefinition,
    val totalCards: Int,
    val dueCards: Int,
    val newCards: Int,
    val reviewedCards: Int,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
)

// Keep in sync with apps/backend/src/workspaceSchedulerSettings.ts::WorkspaceSchedulerSettings, apps/web/src/types.ts::WorkspaceSchedulerSettings, and apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::WorkspaceSchedulerSettings.
data class WorkspaceSchedulerSettings(
    val workspaceId: String,
    val algorithm: String,
    val desiredRetention: Double,
    val learningStepsMinutes: List<Int>,
    val relearningStepsMinutes: List<Int>,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean,
    val updatedAtMillis: Long
)

// Keep in sync with apps/backend/src/cards.ts::Card, apps/web/src/types.ts::Card, and apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift::Card.
data class CardSummary(
    val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val dueAtMillis: Long?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?,
    val deletedAtMillis: Long?
)

data class CardDraft(
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel
)

data class CardFilter(
    val tags: List<String>,
    val effort: List<EffortLevel>
)

enum class ReviewRating {
    AGAIN,
    HARD,
    GOOD,
    EASY
}

sealed interface ReviewFilter {
    data object AllCards : ReviewFilter

    data class Deck(
        val deckId: String
    ) : ReviewFilter

    data class Effort(
        val effortLevel: EffortLevel
    ) : ReviewFilter

    data class Tag(
        val tag: String
    ) : ReviewFilter
}

data class ReviewCard(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
    val dueAtMillis: Long?,
    val updatedAtMillis: Long,
    val createdAtMillis: Long,
    val reps: Int,
    val lapses: Int,
    val queueStatus: ReviewCardQueueStatus
)

data class PendingReviewedCard(
    val cardId: String,
    val updatedAtMillis: Long
)

enum class ReviewCardQueueStatus {
    ACTIVE,
    FUTURE,
    RATED
}

// Keep in sync with apps/backend/src/schedule.ts::ReviewSchedule, apps/ios/Flashcards/Flashcards/FsrsScheduler.swift::ReviewSchedule, and the Android scheduler mirror in FsrsScheduler.kt.
data class ReviewSchedule(
    val dueAtMillis: Long?,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?
)

// Keep review answer option presentation aligned with apps/ios/Flashcards/Flashcards/ReviewAnswerSupport.swift and the Android scheduler mirror in ReviewAnswerSupport.kt.
data class ReviewAnswerOption(
    val rating: ReviewRating,
    val intervalDescription: ReviewIntervalDescription
)

data class ReviewDeckFilterOption(
    val deckId: String,
    val title: String,
    val totalCount: Int
)

data class ReviewEffortFilterOption(
    val effortLevel: EffortLevel,
    val title: String,
    val totalCount: Int
)

data class ReviewTagFilterOption(
    val tag: String,
    val totalCount: Int
)

data class ReviewSessionSnapshot(
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val cards: List<ReviewCard>,
    val answerOptions: List<ReviewAnswerOption>,
    val nextAnswerOptions: List<ReviewAnswerOption>,
    val answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>,
    val remainingCount: Int,
    val totalCount: Int,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>,
    val isLoading: Boolean
)

data class ReviewTimelinePage(
    val cards: List<ReviewCard>,
    val hasMoreCards: Boolean
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

data class WorkspaceTagSummary(
    val tag: String,
    val cardsCount: Int
)

data class WorkspaceTagsSummary(
    val tags: List<WorkspaceTagSummary>,
    val totalCards: Int
)

data class WorkspaceOverviewSummary(
    val workspaceId: String,
    val workspaceName: String,
    val totalCards: Int,
    val deckCount: Int,
    val tagsCount: Int,
    val dueCount: Int,
    val newCount: Int,
    val reviewedCount: Int
)

data class WorkspaceExportCard(
    val frontText: String,
    val backText: String,
    val tags: List<String>
)

data class WorkspaceExportData(
    val workspaceId: String,
    val workspaceName: String,
    val cards: List<WorkspaceExportCard>
)
