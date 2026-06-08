package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressRepositoryWarning
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject

internal fun validateProgressReviewScheduleBuckets(
    buckets: List<CloudProgressReviewScheduleBucket>,
    totalCards: Int
) {
    val expectedKeys = ProgressReviewScheduleBucketKey.orderedEntries
    val actualKeys = buckets.map(CloudProgressReviewScheduleBucket::key)
    if (actualKeys != expectedKeys) {
        throw IllegalArgumentException(
            "Review schedule buckets must use the stable key order '${expectedKeys.joinToString { key -> key.wireKey }}'."
        )
    }
    val countedCards = buckets.sumOf { bucket ->
        if (bucket.count < 0) {
            throw IllegalArgumentException("Review schedule bucket '${bucket.key.wireKey}' has a negative count.")
        }
        bucket.count
    }
    if (totalCards < 0) {
        throw IllegalArgumentException("Review schedule totalCards must not be negative.")
    }
    if (countedCards != totalCards) {
        throw IllegalArgumentException(
            "Review schedule bucket counts ($countedCards) must match totalCards ($totalCards)."
        )
    }
}

internal fun validateProgressReviewScheduleResponseTimeZone(
    schedule: CloudProgressReviewSchedule,
    scopeKey: ProgressReviewScheduleScopeKey
) {
    if (schedule.timeZone == scopeKey.timeZone) {
        return
    }

    throw IllegalArgumentException(
        "Progress review schedule response timeZone '${schedule.timeZone}' did not match requested timeZone " +
            "'${scopeKey.timeZone}' for scope '${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'. " +
            "Check the progress API response before caching this schedule."
    )
}

internal fun validateProgressReviewScheduleCacheTimeZone(
    cacheTimeZone: String,
    scopeKey: ProgressReviewScheduleScopeKey
) {
    if (cacheTimeZone == scopeKey.timeZone) {
        return
    }

    throw IllegalArgumentException(
        "Cached progress review schedule timeZone '$cacheTimeZone' did not match requested timeZone " +
            "'${scopeKey.timeZone}' for scope '${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'. " +
            "Refresh the progress review schedule before rendering this cache."
    )
}

// Decide whether the local review-schedule fallback can replace the server-base schedule.
//
// Gating contract (must match iOS FlashcardsStore+ProgressSnapshot.swift:155-184 and
// web apps/web/src/appData/progress/snapshots/progressSnapshots.ts:175-185):
//   1. The local cache must be fully hydrated for the scope (isLocalReviewScheduleScopeHydrated).
//      Without full hydration the local cards table cannot represent the user-wide schedule.
//   2. localFallback.totalCards - pendingCardTotalDelta must equal serverBase.totalCards.
//      pendingCardTotalDelta only accounts for net card creates and deletes, not for
//      due-date/FSRS edits or text edits on already-server-synced cards.
//
// Why totals-equality is sufficient (the bucket-equality invariant):
//   Every outbox entry whose card mutation can shift the review schedule is enqueued with
//   affectsReviewSchedule = true (see LocalCardsRepository.createCard/deleteCard,
//   LocalReviewRepository.recordReview, and the iOS/web equivalents). Specifically:
//     - card creates set the flag to true,
//     - card deletes set the flag to true,
//     - card reviews set the flag to true (these update due-date and FSRS state in the
//       local cards row),
//     - text-only updates set the flag to false because they cannot move a card between
//       buckets.
//   The caller already checks hasPendingScheduleImpactingCardChanges before invoking this
//   function, so we are inside the gated branch only when at least one schedule-impacting
//   mutation is pending. If, in addition, totals match after subtracting net creates/deletes,
//   then the local-only divergence from the server is necessarily in the bucket distribution
//   driven by un-pushed reviews on already-server-synced cards. Those reviews already wrote
//   the new due-date and FSRS state into the local cards table, so localFallback already
//   reflects the post-review buckets that the user expects to see. Therefore replacing the
//   stale server bucketing with localFallback is the correct rendering, not a stale overlay.
//
// If a future code path enqueues a schedule-shifting mutation with affectsReviewSchedule = false
// (i.e. breaks invariant #2), this gating becomes unsafe and the cross-platform contract must
// be revisited together with iOS and web.
internal fun canReplaceReviewScheduleWithLocalOverlay(
    localFallback: CloudProgressReviewSchedule,
    serverBase: CloudProgressReviewSchedule,
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    isLocalReviewScheduleScopeHydrated: Boolean,
    workspaceIds: List<String>
): Boolean {
    if (isLocalReviewScheduleScopeHydrated.not()) {
        return false
    }

    val pendingCardTotalDelta = try {
        calculatePendingReviewScheduleCardTotalDelta(
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            workspaceIds = workspaceIds
        )
    } catch (error: IllegalArgumentException) {
        logProgressRepositoryWarning(
            event = "progress_review_schedule_pending_total_delta_skipped",
            fields = listOf(
                "timeZone" to localFallback.timeZone,
                "workspaceIds" to workspaceIds.joinToString(separator = ",")
            ),
            error = error
        )
        return false
    }

    return localFallback.totalCards - pendingCardTotalDelta == serverBase.totalCards
}

internal fun calculatePendingReviewScheduleCardTotalDelta(
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): Int {
    val workspaceIdSet = workspaceIds.toSet()
    val changesByCardId = linkedMapOf<String, PendingReviewScheduleCardTotalChange>()
    pendingCardUpsertOutboxEntries.forEach { entry ->
        if (
            workspaceIdSet.contains(entry.workspaceId).not() ||
            entry.entityType != "card" ||
            entry.operationType != "upsert" ||
            entry.affectsReviewSchedule.not()
        ) {
            return@forEach
        }

        val parsedChange = parsePendingReviewScheduleCardTotalChange(entry = entry)
        val existingChange = changesByCardId[entry.entityId]
        changesByCardId[entry.entityId] = PendingReviewScheduleCardTotalChange(
            hasLocalCreate = existingChange?.hasLocalCreate == true || parsedChange.hasLocalCreate,
            finalIsDeleted = parsedChange.finalIsDeleted
        )
    }

    return changesByCardId.values.sumOf { change ->
        when {
            change.hasLocalCreate && change.finalIsDeleted -> 0
            change.hasLocalCreate -> 1
            change.finalIsDeleted -> -1
            else -> 0
        }
    }
}

private data class PendingReviewScheduleCardTotalChange(
    val hasLocalCreate: Boolean,
    val finalIsDeleted: Boolean
)

private fun parsePendingReviewScheduleCardTotalChange(
    entry: OutboxEntryEntity
): PendingReviewScheduleCardTotalChange {
    val payloadJsonObject = try {
        JSONObject(entry.payloadJson)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid pending card upsert payload JSON for outbox entry '${entry.outboxEntryId}'.",
            error
        )
    }
    val payloadCardId = payloadJsonObject.optString("cardId", entry.entityId)
    if (payloadCardId != entry.entityId) {
        throw IllegalArgumentException(
            "Pending card upsert outbox entry '${entry.outboxEntryId}' entityId '${entry.entityId}' " +
                "does not match payload cardId '$payloadCardId'."
        )
    }

    val createdAt = if (payloadJsonObject.has("createdAt") && payloadJsonObject.isNull("createdAt").not()) {
        try {
            payloadJsonObject.getString("createdAt")
        } catch (error: Exception) {
            throw IllegalArgumentException(
                "Invalid createdAt in pending card upsert payload for outbox entry '${entry.outboxEntryId}'.",
                error
            )
        }
    } else {
        null
    }

    return PendingReviewScheduleCardTotalChange(
        hasLocalCreate = createdAt == entry.clientUpdatedAtIso,
        finalIsDeleted = payloadJsonObject.has("deletedAt") && payloadJsonObject.isNull("deletedAt").not()
    )
}

internal data class ProgressReviewScheduleBucketStarts(
    val startOfTomorrowMillis: Long,
    val startOfDay8Millis: Long,
    val startOfDay31Millis: Long,
    val startOfDay91Millis: Long,
    val startOfDay361Millis: Long,
    val startOfDay721Millis: Long
)

internal fun createProgressReviewScheduleBucketStarts(
    today: LocalDate,
    zoneId: ZoneId
): ProgressReviewScheduleBucketStarts {
    return ProgressReviewScheduleBucketStarts(
        startOfTomorrowMillis = startOfLocalDateMillis(
            date = today.plusDays(1L),
            zoneId = zoneId
        ),
        startOfDay8Millis = startOfLocalDateMillis(
            date = today.plusDays(8L),
            zoneId = zoneId
        ),
        startOfDay31Millis = startOfLocalDateMillis(
            date = today.plusDays(31L),
            zoneId = zoneId
        ),
        startOfDay91Millis = startOfLocalDateMillis(
            date = today.plusDays(91L),
            zoneId = zoneId
        ),
        startOfDay361Millis = startOfLocalDateMillis(
            date = today.plusDays(361L),
            zoneId = zoneId
        ),
        startOfDay721Millis = startOfLocalDateMillis(
            date = today.plusDays(721L),
            zoneId = zoneId
        )
    )
}

private fun startOfLocalDateMillis(
    date: LocalDate,
    zoneId: ZoneId
): Long {
    return date.atStartOfDay(zoneId).toInstant().toEpochMilli()
}

internal fun bucketReviewDueAtMillis(
    dueAtMillis: Long?,
    bucketStarts: ProgressReviewScheduleBucketStarts
): ProgressReviewScheduleBucketKey {
    if (dueAtMillis == null) {
        return ProgressReviewScheduleBucketKey.NEW
    }

    return when {
        dueAtMillis < bucketStarts.startOfTomorrowMillis -> ProgressReviewScheduleBucketKey.TODAY
        dueAtMillis < bucketStarts.startOfDay8Millis -> ProgressReviewScheduleBucketKey.DAYS_1_TO_7
        dueAtMillis < bucketStarts.startOfDay31Millis -> ProgressReviewScheduleBucketKey.DAYS_8_TO_30
        dueAtMillis < bucketStarts.startOfDay91Millis -> ProgressReviewScheduleBucketKey.DAYS_31_TO_90
        dueAtMillis < bucketStarts.startOfDay361Millis -> ProgressReviewScheduleBucketKey.DAYS_91_TO_360
        dueAtMillis < bucketStarts.startOfDay721Millis -> ProgressReviewScheduleBucketKey.YEARS_1_TO_2
        else -> ProgressReviewScheduleBucketKey.LATER
    }
}
