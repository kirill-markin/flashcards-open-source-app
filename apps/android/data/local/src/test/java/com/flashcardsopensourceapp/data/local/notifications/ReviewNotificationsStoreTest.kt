package com.flashcardsopensourceapp.data.local.notifications

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewNotificationsStoreTest {
    @Test
    fun inactivityReminderPayloadsRepeatAcrossCurrentAndLaterDays() {
        val zoneId = ZoneId.of("UTC")
        val payloads = buildInactivityReminderPayloads(
            workspaceId = "workspace-1",
            currentCard = makeCurrentCard(cardId = "card-a", frontText = "Front A"),
            nowMillis = parseTimestampMillis(value = "2026-04-03T10:16:00Z"),
            lastActiveAtMillis = parseTimestampMillis(value = "2026-04-03T10:15:00Z"),
            zoneId = zoneId,
            settings = InactivityReviewNotificationsSettings(
                windowStartHour = 10,
                windowStartMinute = 0,
                windowEndHour = 19,
                windowEndMinute = 0,
                idleMinutes = 120
            )
        )

        assertEquals(
            listOf(
                "2026-04-03T12:15:00Z",
                "2026-04-03T14:15:00Z",
                "2026-04-03T16:15:00Z",
                "2026-04-03T18:15:00Z",
                "2026-04-04T10:00:00Z",
                "2026-04-04T12:00:00Z",
                "2026-04-04T14:00:00Z",
                "2026-04-04T16:00:00Z",
                "2026-04-04T18:00:00Z"
            ),
            payloads.take(9).map { payload ->
                formatTimestampMillis(
                    value = payload.scheduledAtMillis,
                    zoneId = zoneId
                )
            }
        )
    }

    @Test
    fun inactivityReminderPayloadsSnapToWindowStartBeforeWindow() {
        val zoneId = ZoneId.of("UTC")
        val payloads = buildInactivityReminderPayloads(
            workspaceId = "workspace-1",
            currentCard = makeCurrentCard(cardId = "card-a", frontText = "Front A"),
            nowMillis = parseTimestampMillis(value = "2026-04-03T07:31:00Z"),
            lastActiveAtMillis = parseTimestampMillis(value = "2026-04-03T07:30:00Z"),
            zoneId = zoneId,
            settings = InactivityReviewNotificationsSettings(
                windowStartHour = 10,
                windowStartMinute = 0,
                windowEndHour = 19,
                windowEndMinute = 0,
                idleMinutes = 120
            )
        )

        assertEquals(
            listOf(
                "2026-04-03T10:00:00Z",
                "2026-04-03T12:00:00Z",
                "2026-04-03T14:00:00Z",
                "2026-04-03T16:00:00Z",
                "2026-04-03T18:00:00Z"
            ),
            payloads.take(5).map { payload ->
                formatTimestampMillis(
                    value = payload.scheduledAtMillis,
                    zoneId = zoneId
                )
            }
        )
    }

    @Test
    fun inactivityReminderPayloadsUseReplacementCurrentCardAndUniqueIdentifiers() {
        val zoneId = ZoneId.of("UTC")
        val scheduledAtMillisList = listOf(
            parseTimestampMillis(value = "2026-04-03T12:15:00Z"),
            parseTimestampMillis(value = "2026-04-03T14:15:00Z")
        )

        val originalPayloads = scheduledAtMillisList.map { scheduledAtMillis ->
            ScheduledReviewNotificationPayload(
                workspaceId = "workspace-1",
                reviewFilter = makeCurrentCard(cardId = "card-a", frontText = "Front A").reviewFilter,
                cardId = "card-a",
                frontText = "Front A",
                scheduledAtMillis = scheduledAtMillis,
                requestId = makeNotificationRequestId(
                    workspaceId = "workspace-1",
                    mode = ReviewNotificationMode.INACTIVITY,
                    suffix = makeNotificationRequestSuffix(
                        scheduledAtDateTime = Instant.ofEpochMilli(scheduledAtMillis).atZone(zoneId)
                    )
                )
            )
        }
        val replacementPayloads = buildInactivityReminderPayloads(
            workspaceId = "workspace-1",
            currentCard = makeCurrentCard(cardId = "card-b", frontText = "Front B"),
            nowMillis = parseTimestampMillis(value = "2026-04-03T10:16:00Z"),
            lastActiveAtMillis = parseTimestampMillis(value = "2026-04-03T10:15:00Z"),
            zoneId = zoneId,
            settings = InactivityReviewNotificationsSettings(
                windowStartHour = 10,
                windowStartMinute = 0,
                windowEndHour = 19,
                windowEndMinute = 0,
                idleMinutes = 120
            )
        ).take(2)

        assertEquals(listOf("card-a", "card-a"), originalPayloads.map { it.cardId })
        assertEquals(listOf("card-b", "card-b"), replacementPayloads.map { it.cardId })
        assertEquals(listOf("Front B", "Front B"), replacementPayloads.map { it.frontText })
        assertEquals(replacementPayloads.size, replacementPayloads.map { it.requestId }.toSet().size)
    }
}

private fun makeCurrentCard(cardId: String, frontText: String): CurrentReviewNotificationCard {
    return CurrentReviewNotificationCard(
        reviewFilter = PersistedReviewFilter(
            kind = "allCards",
            deckId = null,
            tag = null
        ),
        cardId = cardId,
        frontText = frontText
    )
}

private fun parseTimestampMillis(value: String): Long {
    return Instant.parse(value).toEpochMilli()
}

private fun formatTimestampMillis(value: Long, zoneId: ZoneId): String {
    return Instant.ofEpochMilli(value).atZone(zoneId).toInstant().toString()
}
