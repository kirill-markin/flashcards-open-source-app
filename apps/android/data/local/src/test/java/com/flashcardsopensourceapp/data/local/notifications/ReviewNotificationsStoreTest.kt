package com.flashcardsopensourceapp.data.local.notifications

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ReviewNotificationsStoreTest {
    @Test
    fun buildDailyReminderPayloadsRepeatsSameCurrentCardForAllScheduledTimes() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val nowMillis = ZonedDateTime.of(2026, 3, 28, 11, 5, 0, 0, zoneId)
            .toInstant()
            .toEpochMilli()
        val payloads = buildDailyReminderPayloads(
            workspaceId = "workspace-local",
            currentCard = CurrentReviewNotificationCard(
                reviewFilter = makePersistedReviewFilter(reviewFilter = com.flashcardsopensourceapp.data.local.model.ReviewFilter.AllCards),
                cardId = "card-1",
                frontText = "Question"
            ),
            nowMillis = nowMillis,
            zoneId = zoneId,
            settings = DailyReviewNotificationsSettings(
                hour = 10,
                minute = 0
            )
        )

        assertEquals(6, payloads.size)
        assertEquals(setOf("card-1"), payloads.map { payload -> payload.cardId }.toSet())
        assertEquals(setOf("Question"), payloads.map { payload -> payload.frontText }.toSet())
    }

    @Test
    fun buildInactivityReminderPayloadsRepeatsSameCurrentCardForAllScheduledTimes() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val payloads = buildInactivityReminderPayloads(
            workspaceId = "workspace-local",
            currentCard = CurrentReviewNotificationCard(
                reviewFilter = makePersistedReviewFilter(reviewFilter = com.flashcardsopensourceapp.data.local.model.ReviewFilter.AllCards),
                cardId = "card-1",
                frontText = "Question"
            ),
            nowMillis = ZonedDateTime.of(2026, 3, 28, 11, 5, 0, 0, zoneId)
                .toInstant()
                .toEpochMilli(),
            lastActiveAtMillis = ZonedDateTime.of(2026, 3, 28, 11, 0, 0, 0, zoneId)
                .toInstant()
                .toEpochMilli(),
            zoneId = zoneId,
            settings = InactivityReviewNotificationsSettings(
                windowStartHour = 10,
                windowStartMinute = 0,
                windowEndHour = 19,
                windowEndMinute = 0,
                idleMinutes = 120
            )
        )

        assertEquals(7, payloads.size)
        assertEquals(setOf("card-1"), payloads.map { payload -> payload.cardId }.toSet())
        assertEquals(setOf("Question"), payloads.map { payload -> payload.frontText }.toSet())
    }

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
