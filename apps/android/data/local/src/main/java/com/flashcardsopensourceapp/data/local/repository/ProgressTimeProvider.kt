package com.flashcardsopensourceapp.data.local.repository

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

interface ProgressTimeProvider {
    fun currentZoneId(): ZoneId
    fun currentTimeMillis(): Long
}

object SystemProgressTimeProvider : ProgressTimeProvider {
    override fun currentZoneId(): ZoneId {
        return ZoneId.systemDefault()
    }

    override fun currentTimeMillis(): Long {
        return System.currentTimeMillis()
    }
}

internal data class ProgressClockSnapshot(
    val zoneId: ZoneId,
    val currentTimeMillis: Long,
    val today: LocalDate
)

internal fun createProgressClockSnapshot(
    timeProvider: ProgressTimeProvider
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
