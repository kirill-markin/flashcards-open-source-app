package com.flashcardsopensourceapp.data.local.notifications

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

const val strictReminderSchedulingMaxDayOffset: Int = 7

enum class StrictReminderTimeOffset(
    val rawValue: String,
    val hoursBeforeEndOfDay: Long
) {
    FOUR_HOURS(rawValue = "4h", hoursBeforeEndOfDay = 4L),
    THREE_HOURS(rawValue = "3h", hoursBeforeEndOfDay = 3L),
    TWO_HOURS(rawValue = "2h", hoursBeforeEndOfDay = 2L);

    companion object {
        fun fromRawValue(rawValue: String): StrictReminderTimeOffset {
            return entries.firstOrNull { entry ->
                entry.rawValue == rawValue
            } ?: throw IllegalArgumentException(
                "Strict reminder time offset '$rawValue' is not supported."
            )
        }
    }
}

data class StrictRemindersSettings(
    val isEnabled: Boolean
)

data class ScheduledStrictReminderPayload(
    val scheduledAtMillis: Long,
    val timeOffset: StrictReminderTimeOffset,
    val requestId: String
)

data class StrictReminderLocalDateWindow(
    val startMillis: Long,
    val endMillis: Long
)

fun defaultStrictRemindersSettings(): StrictRemindersSettings {
    return StrictRemindersSettings(isEnabled = true)
}

fun isStrictReminderLocalDateCompleted(
    localDate: LocalDate,
    zoneId: ZoneId,
    completedReviewAtMillis: Long?
): Boolean {
    if (completedReviewAtMillis == null) {
        return false
    }

    val completedReviewLocalDate = Instant.ofEpochMilli(completedReviewAtMillis)
        .atZone(zoneId)
        .toLocalDate()
    return completedReviewLocalDate == localDate
}

fun mergeStrictReminderCompletedReviewAtMillis(
    existingCompletedReviewAtMillis: Long?,
    candidateCompletedReviewAtMillis: Long?
): Long? {
    return when {
        existingCompletedReviewAtMillis == null -> candidateCompletedReviewAtMillis
        candidateCompletedReviewAtMillis == null -> existingCompletedReviewAtMillis
        else -> maxOf(existingCompletedReviewAtMillis, candidateCompletedReviewAtMillis)
    }
}

fun buildStrictReminderLocalDateWindow(
    localDate: LocalDate,
    zoneId: ZoneId
): StrictReminderLocalDateWindow {
    val startOfDay = localDate.atStartOfDay(zoneId)
    val startOfNextDay = localDate.plusDays(1L).atStartOfDay(zoneId)
    return StrictReminderLocalDateWindow(
        startMillis = startOfDay.toInstant().toEpochMilli(),
        endMillis = startOfNextDay.toInstant().toEpochMilli()
    )
}

fun resolveStrictReminderCompletedReviewAtMillis(
    currentLocalDate: LocalDate,
    zoneId: ZoneId,
    existingCompletedReviewAtMillis: Long?,
    hasReviewLogsInCurrentLocalDate: Boolean
): Long? {
    val isCurrentLocalDateCompleted = isStrictReminderLocalDateCompleted(
        localDate = currentLocalDate,
        zoneId = zoneId,
        completedReviewAtMillis = existingCompletedReviewAtMillis
    )

    if (hasReviewLogsInCurrentLocalDate.not()) {
        return if (isCurrentLocalDateCompleted) {
            null
        } else {
            existingCompletedReviewAtMillis
        }
    }

    if (
        isCurrentLocalDateCompleted
    ) {
        return existingCompletedReviewAtMillis
    }

    return buildStrictReminderLocalDateWindow(
        localDate = currentLocalDate,
        zoneId = zoneId
    ).startMillis
}

suspend fun buildStrictReminderPayloads(
    nowMillis: Long,
    zoneId: ZoneId,
    isLocalDateCompleted: suspend (LocalDate) -> Boolean
): List<ScheduledStrictReminderPayload> {
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)

    return (0..strictReminderSchedulingMaxDayOffset).flatMap { dayOffset ->
        val localDate = now.toLocalDate().plusDays(dayOffset.toLong())
        buildStrictReminderPayloadsForLocalDate(
            localDate = localDate,
            nowMillis = nowMillis,
            zoneId = zoneId,
            isLocalDateCompleted = isLocalDateCompleted
        )
    }
}

fun makeStrictReminderRequestId(
    localDate: LocalDate,
    timeOffset: StrictReminderTimeOffset
): String {
    return "strict-reminder::${localDate.format(strictReminderLocalDateFormatter)}::${timeOffset.rawValue}"
}

private suspend fun buildStrictReminderPayloadsForLocalDate(
    localDate: LocalDate,
    nowMillis: Long,
    zoneId: ZoneId,
    isLocalDateCompleted: suspend (LocalDate) -> Boolean
): List<ScheduledStrictReminderPayload> {
    val startOfNextDay = localDate.plusDays(1L).atStartOfDay(zoneId)

    if (isLocalDateCompleted(localDate)) {
        return emptyList()
    }

    return StrictReminderTimeOffset.entries.mapNotNull { timeOffset ->
        val scheduledAt = startOfNextDay.minusHours(timeOffset.hoursBeforeEndOfDay)
        val scheduledAtMillis = scheduledAt.toInstant().toEpochMilli()
        if (scheduledAtMillis <= nowMillis) {
            return@mapNotNull null
        }

        ScheduledStrictReminderPayload(
            scheduledAtMillis = scheduledAtMillis,
            timeOffset = timeOffset,
            requestId = makeStrictReminderRequestId(
                localDate = localDate,
                timeOffset = timeOffset
            )
        )
    }
}

private val strictReminderLocalDateFormatter: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE
