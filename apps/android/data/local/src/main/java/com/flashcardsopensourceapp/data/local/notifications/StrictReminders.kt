package com.flashcardsopensourceapp.data.local.notifications

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

const val strictReminderSchedulingMaxDayOffset: Int = 7
const val strictReminderWorkLimit: Int = 24

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
    val workspaceId: String,
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
    workspaceId: String,
    nowMillis: Long,
    zoneId: ZoneId,
    isLocalDateCompleted: suspend (LocalDate) -> Boolean
): List<ScheduledStrictReminderPayload> {
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)

    return (0..strictReminderSchedulingMaxDayOffset).flatMap { dayOffset ->
        val localDate = now.toLocalDate().plusDays(dayOffset.toLong())
        buildStrictReminderPayloadsForLocalDate(
            workspaceId = workspaceId,
            localDate = localDate,
            nowMillis = nowMillis,
            zoneId = zoneId,
            isLocalDateCompleted = isLocalDateCompleted
        )
    }.sortedBy { payload ->
        payload.scheduledAtMillis
    }.take(strictReminderWorkLimit)
}

fun makeStrictReminderRequestId(
    workspaceId: String,
    localDate: LocalDate,
    timeOffset: StrictReminderTimeOffset
): String {
    return "$strictReminderRequestIdPrefix::$workspaceId::${localDate.format(strictReminderLocalDateFormatter)}::${timeOffset.rawValue}"
}

fun isStrictReminderRequestIdValid(
    requestId: String,
    workspaceId: String?,
    timeOffset: StrictReminderTimeOffset
): Boolean {
    val components = requestId.split("::")
    if (components.firstOrNull() != strictReminderRequestIdPrefix) {
        return false
    }

    val identityComponents: Triple<String?, String, String> = when (components.size) {
        3 -> Triple(null, components[1], components[2])
        4 -> {
            val embeddedWorkspaceId = components[1]
            if (embeddedWorkspaceId.isBlank()) {
                return false
            }
            Triple(embeddedWorkspaceId, components[2], components[3])
        }
        else -> return false
    }
    val embeddedWorkspaceId = identityComponents.first
    if (embeddedWorkspaceId != workspaceId) {
        return false
    }

    val localDate = try {
        LocalDate.parse(identityComponents.second, strictReminderLocalDateFormatter)
    } catch (_: DateTimeParseException) {
        return false
    }
    val embeddedTimeOffset = try {
        StrictReminderTimeOffset.fromRawValue(rawValue = identityComponents.third)
    } catch (_: IllegalArgumentException) {
        return false
    }
    if (embeddedTimeOffset != timeOffset) {
        return false
    }

    val canonicalRequestId = if (embeddedWorkspaceId == null) {
        makeLegacyStrictReminderRequestId(
            localDate = localDate,
            timeOffset = embeddedTimeOffset
        )
    } else {
        makeStrictReminderRequestId(
            workspaceId = embeddedWorkspaceId,
            localDate = localDate,
            timeOffset = embeddedTimeOffset
        )
    }
    return requestId == canonicalRequestId
}

private suspend fun buildStrictReminderPayloadsForLocalDate(
    workspaceId: String,
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
            workspaceId = workspaceId,
            scheduledAtMillis = scheduledAtMillis,
            timeOffset = timeOffset,
            requestId = makeStrictReminderRequestId(
                workspaceId = workspaceId,
                localDate = localDate,
                timeOffset = timeOffset
            )
        )
    }
}

private val strictReminderLocalDateFormatter: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE
private const val strictReminderRequestIdPrefix: String = "strict-reminder"

private fun makeLegacyStrictReminderRequestId(
    localDate: LocalDate,
    timeOffset: StrictReminderTimeOffset
): String {
    return "$strictReminderRequestIdPrefix::${localDate.format(strictReminderLocalDateFormatter)}::${timeOffset.rawValue}"
}
