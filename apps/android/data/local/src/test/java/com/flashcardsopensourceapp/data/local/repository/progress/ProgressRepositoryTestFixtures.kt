package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import java.time.LocalDate
import java.time.ZoneId

internal fun createCloudSettings(
    cloudState: CloudAccountState
): CloudSettings {
    return CloudSettings(
        installationId = "installation-1",
        cloudState = cloudState,
        linkedUserId = "user-1",
        linkedWorkspaceId = "workspace-1",
        linkedEmail = "user@example.com",
        activeWorkspaceId = "workspace-1",
        updatedAtMillis = 0L
    )
}

internal fun createProgressLocalDayCount(
    workspaceId: String,
    localDate: String,
    reviewCount: Int
): ProgressLocalDayCountEntity {
    return ProgressLocalDayCountEntity(
        timeZone = "Europe/Madrid",
        workspaceId = workspaceId,
        localDate = localDate,
        reviewCount = reviewCount
    )
}

internal fun createProgressReviewHistoryState(
    workspaceId: String,
    historyVersion: Long
): ProgressReviewHistoryStateEntity {
    return ProgressReviewHistoryStateEntity(
        workspaceId = workspaceId,
        historyVersion = historyVersion,
        reviewLogCount = historyVersion.toInt(),
        maxReviewedAtMillis = historyVersion
    )
}

internal fun createProgressLocalCacheState(
    workspaceId: String,
    historyVersion: Long,
    timeZone: String
): ProgressLocalCacheStateEntity {
    return ProgressLocalCacheStateEntity(
        timeZone = timeZone,
        workspaceId = workspaceId,
        historyVersion = historyVersion,
        updatedAtMillis = historyVersion
    )
}

internal fun createSyncState(
    workspaceId: String,
    hasHydratedHotState: Boolean
): SyncStateEntity {
    return SyncStateEntity(
        workspaceId = workspaceId,
        lastSyncCursor = null,
        lastReviewSequenceId = 0L,
        hasHydratedHotState = hasHydratedHotState,
        hasHydratedReviewHistory = true,
        pendingReviewHistoryImport = false,
        lastSyncAttemptAtMillis = null,
        lastSuccessfulSyncAtMillis = null,
        lastSyncError = null,
        blockedInstallationId = null
    )
}

internal fun createReviewScheduleCardDue(
    cardId: String,
    workspaceId: String,
    dueAtMillis: Long?
): ProgressReviewScheduleCardDueEntity {
    return ProgressReviewScheduleCardDueEntity(
        cardId = cardId,
        workspaceId = workspaceId,
        dueAtMillis = dueAtMillis
    )
}

internal fun startOfLocalDateMillisForTest(
    date: LocalDate,
    zoneId: ZoneId
): Long {
    return date.atStartOfDay(zoneId).toInstant().toEpochMilli()
}

internal fun createReviewSchedule(
    timeZone: String,
    newCount: Int,
    todayCount: Int
): CloudProgressReviewSchedule {
    val buckets: List<CloudProgressReviewScheduleBucket> = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
        CloudProgressReviewScheduleBucket(
            key = key,
            count = when (key) {
                ProgressReviewScheduleBucketKey.NEW -> newCount
                ProgressReviewScheduleBucketKey.TODAY -> todayCount
                ProgressReviewScheduleBucketKey.DAYS_1_TO_7,
                ProgressReviewScheduleBucketKey.DAYS_8_TO_30,
                ProgressReviewScheduleBucketKey.DAYS_31_TO_90,
                ProgressReviewScheduleBucketKey.DAYS_91_TO_360,
                ProgressReviewScheduleBucketKey.YEARS_1_TO_2,
                ProgressReviewScheduleBucketKey.LATER -> 0
            }
        )
    }

    return CloudProgressReviewSchedule(
        timeZone = timeZone,
        generatedAt = null,
        totalCards = buckets.sumOf(CloudProgressReviewScheduleBucket::count),
        buckets = buckets
    )
}

internal fun createPendingReviewOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    reviewedAtClient: String
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "review_event",
        entityId = "review-1",
        operationType = "append",
        payloadJson = """{"reviewEventId":"review-1","cardId":"card-1","clientEventId":"client-1","rating":2,"reviewedAtClient":"$reviewedAtClient"}""",
        clientUpdatedAtIso = "2026-04-18T10:00:00Z",
        createdAtMillis = 0L,
        affectsReviewSchedule = false,
        attemptCount = 0,
        lastError = null
    )
}

internal fun createPendingCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    affectsReviewSchedule: Boolean
): OutboxEntryEntity {
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "card",
        entityId = "card-1",
        operationType = "upsert",
        payloadJson = """{"cardId":"card-1","frontText":"Front","backText":"Back","dueAt":null,"deletedAt":null,"tags":[]}""",
        clientUpdatedAtIso = "2026-04-18T10:00:00Z",
        createdAtMillis = 0L,
        affectsReviewSchedule = affectsReviewSchedule,
        attemptCount = 0,
        lastError = null
    )
}

internal fun createPendingScheduleCreateCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-18T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = null
    )
}

internal fun createPendingScheduleReviewCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-01T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = null
    )
}

internal fun createPendingScheduleDeleteCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String
): OutboxEntryEntity {
    return createPendingScheduleCardUpsertOutboxEntry(
        workspaceId = workspaceId,
        outboxEntryId = outboxEntryId,
        cardId = cardId,
        createdAt = "2026-04-01T10:00:00Z",
        clientUpdatedAt = "2026-04-18T10:00:00Z",
        deletedAt = "2026-04-18T10:00:00Z"
    )
}

private fun createPendingScheduleCardUpsertOutboxEntry(
    workspaceId: String,
    outboxEntryId: String,
    cardId: String,
    createdAt: String,
    clientUpdatedAt: String,
    deletedAt: String?
): OutboxEntryEntity {
    val deletedAtJson: String = deletedAt?.let { value -> "\"$value\"" } ?: "null"
    return OutboxEntryEntity(
        outboxEntryId = outboxEntryId,
        workspaceId = workspaceId,
        installationId = "installation-1",
        entityType = "card",
        entityId = cardId,
        operationType = "upsert",
        payloadJson = """{"cardId":"$cardId","createdAt":"$createdAt","deletedAt":$deletedAtJson}""",
        clientUpdatedAtIso = clientUpdatedAt,
        createdAtMillis = 0L,
        affectsReviewSchedule = true,
        attemptCount = 0,
        lastError = null
    )
}
