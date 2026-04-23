package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

internal data class ProgressPendingReviewLocalDate(
    val workspaceId: String,
    val localDate: String
)

internal data class ProgressPendingReviewFingerprintEntry(
    val workspaceId: String,
    val outboxEntryId: String
)

internal fun createProgressPendingReviewFingerprintEntries(
    pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): List<ProgressPendingReviewFingerprintEntry> {
    val workspaceIdSet = workspaceIds.toSet()
    return pendingReviewOutboxEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId)
    }.map { entry ->
        ProgressPendingReviewFingerprintEntry(
            workspaceId = entry.workspaceId,
            outboxEntryId = entry.outboxEntryId
        )
    }
}

internal fun createProgressPendingReviewLocalDates(
    pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>,
    timeZone: String
): List<ProgressPendingReviewLocalDate> {
    val workspaceIdSet = workspaceIds.toSet()
    val zoneId = ZoneId.of(timeZone)
    return buildList {
        pendingReviewOutboxEntries.forEach { entry ->
            if (workspaceIdSet.contains(entry.workspaceId).not()) {
                return@forEach
            }

            val localDate = try {
                entry.toPendingReviewLocalDate(zoneId = zoneId)
            } catch (error: IllegalArgumentException) {
                logProgressRepositoryWarning(
                    event = "progress_pending_overlay_entry_skipped",
                    fields = listOf(
                        "outboxEntryId" to entry.outboxEntryId,
                        "workspaceId" to entry.workspaceId,
                        "timeZone" to timeZone
                    ),
                    error = error
                )
                return@forEach
            }
            add(
                ProgressPendingReviewLocalDate(
                    workspaceId = entry.workspaceId,
                    localDate = localDate
                )
            )
        }
    }
}

private fun OutboxEntryEntity.toPendingReviewLocalDate(
    zoneId: ZoneId
): String {
    val payloadJsonObject = try {
        JSONObject(payloadJson)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid pending review-event payload JSON for outbox entry '$outboxEntryId': $payloadJson",
            error
        )
    }
    val reviewedAtClient = try {
        payloadJsonObject.getString("reviewedAtClient")
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Missing reviewedAtClient in pending review-event payload for outbox entry '$outboxEntryId': $payloadJson",
            error
        )
    }
    val reviewedAtInstant = try {
        Instant.parse(reviewedAtClient)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid reviewedAtClient '$reviewedAtClient' in pending review-event payload for outbox entry '$outboxEntryId'.",
            error
        )
    }
    return reviewedAtInstant.atZone(zoneId).toLocalDate().toString()
}
