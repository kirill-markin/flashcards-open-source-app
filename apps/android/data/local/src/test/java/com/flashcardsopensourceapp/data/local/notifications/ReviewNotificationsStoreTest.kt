package com.flashcardsopensourceapp.data.local.notifications

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ReviewNotificationsStoreTest {
    @Test
    fun buildInactivityReminderTimestampMillisListKeepsFutureDaysInsideWindow() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val settings = InactivityReviewNotificationsSettings(
            windowStartHour = 10,
            windowStartMinute = 0,
            windowEndHour = 19,
            windowEndMinute = 0,
            idleMinutes = 120
        )
        val lastActiveAtMillis = ZonedDateTime.of(2026, 3, 28, 11, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val nowMillis = ZonedDateTime.of(2026, 3, 28, 11, 5, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()

        val timestamps = buildInactivityReminderTimestampMillisList(
            nowMillis = nowMillis,
            lastActiveAtMillis = lastActiveAtMillis,
            zoneId = zoneId,
            settings = settings
        )

        assertEquals(
            listOf(
                ZonedDateTime.of(2026, 3, 28, 13, 0, 0, 0, zoneId).toInstant().toEpochMilli(),
                ZonedDateTime.of(2026, 3, 29, 10, 0, 0, 0, zoneId).toInstant().toEpochMilli()
            ),
            timestamps.take(2)
        )
    }

    @Test
    fun buildInactivityReminderTimestampMillisListMovesToNextWindowStartAfterWindowEnds() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val settings = InactivityReviewNotificationsSettings(
            windowStartHour = 10,
            windowStartMinute = 0,
            windowEndHour = 19,
            windowEndMinute = 0,
            idleMinutes = 120
        )
        val lastActiveAtMillis = ZonedDateTime.of(2026, 3, 28, 18, 0, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val nowMillis = ZonedDateTime.of(2026, 3, 28, 18, 5, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()

        val timestamps = buildInactivityReminderTimestampMillisList(
            nowMillis = nowMillis,
            lastActiveAtMillis = lastActiveAtMillis,
            zoneId = zoneId,
            settings = settings
        )

        assertEquals(
            listOf(
                ZonedDateTime.of(2026, 3, 29, 10, 0, 0, 0, zoneId).toInstant().toEpochMilli(),
                ZonedDateTime.of(2026, 3, 30, 10, 0, 0, 0, zoneId).toInstant().toEpochMilli()
            ),
            timestamps.take(2)
        )
    }
}
