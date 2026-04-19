package com.flashcardsopensourceapp.data.local.notifications

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewNotificationsStoreTest {
    private val fallbackFrontText: String = "Continue your study session in Flashcards."

    @Test
    fun reviewRemindersDefaultToEnabled() {
        assertEquals(true, defaultReviewNotificationsSettings().isEnabled)
    }

    @Test
    fun strictRemindersDefaultToEnabled() {
        assertEquals(true, defaultStrictRemindersSettings().isEnabled)
    }

    @Test
    fun dailyReminderFallbackPayloadsUseGenericBodyTextAndNullCardId() {
        val zoneId = ZoneId.of("UTC")
        val payloads = buildFallbackDailyReminderPayloads(
            workspaceId = "workspace-1",
            reviewFilter = PersistedReviewFilter(
                kind = "deck",
                deckId = "deck-1",
                effortLevel = null,
                tag = null
            ),
            fallbackFrontText = fallbackFrontText,
            nowMillis = parseTimestampMillis(value = "2026-04-03T09:00:00Z"),
            zoneId = zoneId,
            settings = DailyReviewNotificationsSettings(
                hour = 10,
                minute = 0
            )
        )

        assertEquals(fallbackFrontText, payloads.first().frontText)
        assertEquals(listOf(null, null), payloads.take(2).map { payload -> payload.cardId })
        assertEquals(
            listOf("deck-1", "deck-1"),
            payloads.take(2).map { payload -> payload.reviewFilter.deckId }
        )
        assertEquals(
            listOf(
                "2026-04-03T10:00:00Z",
                "2026-04-04T10:00:00Z"
            ),
            payloads.take(2).map { payload ->
                formatTimestampMillis(
                    value = payload.scheduledAtMillis,
                    zoneId = zoneId
                )
            }
        )
    }

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
    fun inactivityReminderFallbackPayloadsUseGenericBodyTextAndNullCardId() {
        val zoneId = ZoneId.of("UTC")
        val payloads = buildFallbackInactivityReminderPayloads(
            workspaceId = "workspace-1",
            reviewFilter = PersistedReviewFilter(
                kind = "tag",
                deckId = null,
                effortLevel = null,
                tag = "biology"
            ),
            fallbackFrontText = fallbackFrontText,
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

        assertEquals(fallbackFrontText, payloads.first().frontText)
        assertEquals(listOf(null, null), payloads.take(2).map { payload -> payload.cardId })
        assertEquals(
            listOf("biology", "biology"),
            payloads.take(2).map { payload -> payload.reviewFilter.tag }
        )
        assertEquals(
            listOf(
                "2026-04-03T12:15:00Z",
                "2026-04-03T14:15:00Z"
            ),
            payloads.take(2).map { payload ->
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

    @Test
    fun effortReviewFilterRoundTripsThroughNotificationPersistence() {
        val persistedFilter = makePersistedReviewFilter(
            reviewFilter = ReviewFilter.Effort(effortLevel = EffortLevel.MEDIUM)
        )

        assertEquals(
            ReviewFilter.Effort(effortLevel = EffortLevel.MEDIUM),
            decodePersistedReviewFilter(filter = persistedFilter)
        )
        assertEquals("effort", persistedFilter.kind)
        assertEquals(EffortLevel.MEDIUM.name, persistedFilter.effortLevel)
    }

    @Test
    fun strictReminderPayloadsSkipCompletedDaysAndPastCandidates() = runBlocking {
        val zoneId = ZoneId.of("UTC")
        val payloads = buildStrictReminderPayloads(
            nowMillis = parseTimestampMillis(value = "2026-04-03T21:30:00Z"),
            zoneId = zoneId,
            isLocalDateCompleted = { localDate ->
                localDate == LocalDate.parse("2026-04-04")
            }
        )

        assertEquals(
            listOf(
                "strict-reminder::2026-04-03::2h",
                "strict-reminder::2026-04-05::4h",
                "strict-reminder::2026-04-05::3h",
                "strict-reminder::2026-04-05::2h"
            ),
            payloads.take(4).map { payload -> payload.requestId }
        )
        assertEquals(
            listOf(
                "2026-04-03T22:00:00Z",
                "2026-04-05T20:00:00Z",
                "2026-04-05T21:00:00Z",
                "2026-04-05T22:00:00Z"
            ),
            payloads.take(4).map { payload ->
                formatTimestampMillis(
                    value = payload.scheduledAtMillis,
                    zoneId = zoneId
                )
            }
        )
    }

    @Test
    fun strictReminderPayloadsUseStartOfNextDayForDstShift() = runBlocking {
        val zoneId = ZoneId.of("Europe/Madrid")
        val payloads = buildStrictReminderPayloads(
            nowMillis = parseTimestampMillis(value = "2026-03-29T00:00:00Z"),
            zoneId = zoneId,
            isLocalDateCompleted = { _ -> false }
        )

        assertEquals(
            listOf(
                StrictReminderTimeOffset.FOUR_HOURS,
                StrictReminderTimeOffset.THREE_HOURS,
                StrictReminderTimeOffset.TWO_HOURS
            ),
            payloads.take(3).map { payload -> payload.timeOffset }
        )
        assertEquals(
            listOf(
                "20:00",
                "21:00",
                "22:00"
            ),
            payloads.take(3).map { payload ->
                Instant.ofEpochMilli(payload.scheduledAtMillis).atZone(zoneId).toLocalTime().toString()
            }
        )
    }

    @Test
    fun strictReminderCompletionUsesCurrentLocalDateFromPersistedReviewTimestamp() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val completedReviewAtMillis = parseTimestampMillis(value = "2026-04-03T22:30:00Z")

        assertTrue(
            isStrictReminderLocalDateCompleted(
                localDate = LocalDate.parse("2026-04-04"),
                zoneId = zoneId,
                completedReviewAtMillis = completedReviewAtMillis
            )
        )
        assertFalse(
            isStrictReminderLocalDateCompleted(
                localDate = LocalDate.parse("2026-04-03"),
                zoneId = zoneId,
                completedReviewAtMillis = completedReviewAtMillis
            )
        )
    }

    @Test
    fun strictReminderCompletionMergePrefersLatestTimestamp() {
        val existingCompletedReviewAtMillis = parseTimestampMillis(value = "2026-04-03T09:00:00Z")
        val importedCompletedReviewAtMillis = parseTimestampMillis(value = "2026-04-03T13:00:00Z")

        assertEquals(
            importedCompletedReviewAtMillis,
            mergeStrictReminderCompletedReviewAtMillis(
                existingCompletedReviewAtMillis = existingCompletedReviewAtMillis,
                candidateCompletedReviewAtMillis = importedCompletedReviewAtMillis
            )
        )
        assertEquals(
            importedCompletedReviewAtMillis,
            mergeStrictReminderCompletedReviewAtMillis(
                existingCompletedReviewAtMillis = null,
                candidateCompletedReviewAtMillis = importedCompletedReviewAtMillis
            )
        )
        assertEquals(
            existingCompletedReviewAtMillis,
            mergeStrictReminderCompletedReviewAtMillis(
                existingCompletedReviewAtMillis = existingCompletedReviewAtMillis,
                candidateCompletedReviewAtMillis = null
            )
        )
    }

    @Test
    fun strictReminderCompletionBackfillsCurrentLocalDayFromExistingReviewLogs() {
        val zoneId = ZoneId.of("Europe/Madrid")
        val resolvedCompletedReviewAtMillis = resolveStrictReminderCompletedReviewAtMillis(
            currentLocalDate = LocalDate.parse("2026-04-04"),
            zoneId = zoneId,
            existingCompletedReviewAtMillis = parseTimestampMillis(value = "2026-04-02T09:00:00Z"),
            hasReviewLogsInCurrentLocalDate = true
        )

        assertEquals(
            parseTimestampMillis(value = "2026-04-03T22:00:00Z"),
            resolvedCompletedReviewAtMillis
        )
    }
}

private fun makeCurrentCard(cardId: String, frontText: String): CurrentReviewNotificationCard {
    return CurrentReviewNotificationCard(
        reviewFilter = PersistedReviewFilter(
            kind = "allCards",
            deckId = null,
            effortLevel = null,
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
