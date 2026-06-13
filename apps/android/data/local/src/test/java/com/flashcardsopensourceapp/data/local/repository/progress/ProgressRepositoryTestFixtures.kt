package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
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
        reviewHistoryWatermarks = emptyList(),
        totalCards = buckets.sumOf(CloudProgressReviewScheduleBucket::count),
        buckets = buckets
    )
}

internal fun createProgressLeaderboardForTest(
    windowKey: ProgressLeaderboardWindowKey,
    rankingRows: List<CloudProgressLeaderboardRankingRow>
): CloudProgressLeaderboard {
    return CloudProgressLeaderboard(
        status = ProgressLeaderboardStatus.READY,
        metric = CloudProgressLeaderboardMetric(
            metricVersion = "qualified_reviews_v1",
            title = "Qualified reviews",
            description = "Hard, Good, and Easy reviews count toward your rank. Again does not."
        ),
        defaultWindowKey = windowKey,
        windows = listOf(
            createProgressLeaderboardWindowForTest(
                windowKey = windowKey,
                rankingRows = rankingRows
            )
        )
    )
}

internal fun createProgressLeaderboardWindowForTest(
    windowKey: ProgressLeaderboardWindowKey,
    rankingRows: List<CloudProgressLeaderboardRankingRow>
): CloudProgressLeaderboardWindow {
    val viewerRow = requireNotNull(
        rankingRows.firstOrNull { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }
    )
    return CloudProgressLeaderboardWindow(
        windowKey = windowKey,
        snapshotId = "snapshot-1",
        snapshotGeneratedAt = "2026-04-18T14:00:05.000Z",
        asOfServerHour = "2026-04-18T14:00:00.000Z",
        nextRefreshAfter = "2026-04-18T15:00:00.000Z",
        participantCount = rankingRows.size,
        viewer = CloudProgressLeaderboardViewer(
            publicProfileId = viewerRow.publicProfileId,
            rank = viewerRow.rank,
            qualifiedReviewCount = viewerRow.qualifiedReviewCount
        ),
        rows = rankingRows.map { row ->
            createProgressLeaderboardParticipantRowForTest(
                kind = when {
                    row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER -> ProgressLeaderboardParticipantRowKind.VIEWER
                    row.rank <= 3 -> ProgressLeaderboardParticipantRowKind.TOP
                    else -> ProgressLeaderboardParticipantRowKind.NEIGHBOR
                },
                rankingRow = row
            )
        },
        rankingRows = rankingRows
    )
}

internal fun createProgressLeaderboardRankingRowForTest(
    kind: CloudProgressLeaderboardRankingRowKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    qualifiedReviewCount: Int,
    rank: Int
): CloudProgressLeaderboardRankingRow {
    return CloudProgressLeaderboardRankingRow(
        kind = kind,
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}

private fun createProgressLeaderboardParticipantRowForTest(
    kind: ProgressLeaderboardParticipantRowKind,
    rankingRow: CloudProgressLeaderboardRankingRow
): CloudProgressLeaderboardRow.Participant {
    return CloudProgressLeaderboardRow.Participant(
        kind = kind,
        publicProfileId = rankingRow.publicProfileId,
        anonymousDisplayName = rankingRow.anonymousDisplayName,
        qualifiedReviewCount = rankingRow.qualifiedReviewCount,
        rank = rankingRow.rank
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
