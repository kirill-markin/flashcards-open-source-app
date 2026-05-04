package com.flashcardsopensourceapp.data.local.repository

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal data class ProgressClockSnapshot(
    val zoneId: ZoneId,
    val currentTimeMillis: Long,
    val today: LocalDate
)

internal fun createProgressClockSnapshot(
    timeProvider: TimeProvider
): ProgressClockSnapshot {
    val zoneId = timeProvider.currentZoneId()
    val currentTimeMillis = timeProvider.currentTimeMillis()
    return ProgressClockSnapshot(
        zoneId = zoneId,
        currentTimeMillis = currentTimeMillis,
        today = Instant.ofEpochMilli(currentTimeMillis)
            .atZone(zoneId)
            .toLocalDate()
    )
}
