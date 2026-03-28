package com.flashcardsopensourceapp.data.local.model

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

/**
 * Android FSRS parity tests for the Kotlin scheduler copy.
 *
 * Keep in sync with:
 * - apps/backend/src/schedule.test.ts
 * - apps/ios/Flashcards/FlashcardsTests/FsrsSchedulerParityTests.swift
 * - tests/fsrs-full-vectors.json
 * - docs/fsrs-scheduling-logic.md
 */
class FsrsSchedulerParityTest {
    @Test
    fun fullFsrsVectorsMatchSharedParityFixtures() {
        val fixtures = loadFixtures()

        fixtures.forEach { fixture ->
            val settings = fixture.settings
            var state = createEmptyReviewableCardScheduleState(cardId = fixture.cardId)
            var lastSchedule: ReviewSchedule? = null

            fixture.reviews.forEach { review ->
                lastSchedule = computeReviewSchedule(
                    card = state,
                    settings = settings,
                    rating = review.rating,
                    reviewedAtMillis = review.reviewedAtMillis
                )
                state = ReviewableCardScheduleState(
                    cardId = state.cardId,
                    reps = requireNotNull(lastSchedule).reps,
                    lapses = requireNotNull(lastSchedule).lapses,
                    fsrsCardState = requireNotNull(lastSchedule).fsrsCardState,
                    fsrsStepIndex = requireNotNull(lastSchedule).fsrsStepIndex,
                    fsrsStability = requireNotNull(lastSchedule).fsrsStability,
                    fsrsDifficulty = requireNotNull(lastSchedule).fsrsDifficulty,
                    fsrsLastReviewedAtMillis = requireNotNull(lastSchedule).fsrsLastReviewedAtMillis,
                    fsrsScheduledDays = requireNotNull(lastSchedule).fsrsScheduledDays
                )
            }

            assertExpectedSchedule(
                actual = toExpectedSchedule(schedule = lastSchedule),
                expected = fixture.expected,
                message = fixture.name
            )

            val rebuilt = rebuildCardScheduleState(
                cardId = fixture.cardId,
                settings = settings,
                reviewEvents = fixture.reviews.map { review ->
                    FsrsReviewHistoryEvent(
                        rating = review.rating,
                        reviewedAtMillis = review.reviewedAtMillis
                    )
                }
            )
            assertExpectedSchedule(
                actual = toExpectedSchedule(rebuilt = rebuilt),
                expected = fixture.rebuiltExpected,
                message = "${fixture.name} rebuilt"
            )
        }
    }

    @Test
    fun workspaceSchedulerConfigChangesAffectOnlyFutureReviews() {
        val cardId = "config-change-card"
        val updatedSettings = validateWorkspaceSchedulerSettingsInput(
            workspaceId = "workspace-local",
            desiredRetention = 0.90,
            learningStepsMinutes = listOf(1),
            relearningStepsMinutes = listOf(10),
            maximumIntervalDays = 36_500,
            enableFuzz = true,
            updatedAtMillis = 200L
        )

        val firstReviewAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
        val secondReviewAtMillis = parseFixtureTimestamp("2026-03-08T09:01:00.000Z")
        val thirdReviewAtMillis = parseFixtureTimestamp("2026-03-16T09:00:00.000Z")
        val initialSchedule = computeReviewSchedule(
            card = createEmptyReviewableCardScheduleState(cardId = cardId),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = firstReviewAtMillis
        )

        val persistedState = makeStateFromSchedule(cardId = cardId, schedule = initialSchedule)
        val secondFutureSchedule = computeReviewSchedule(
            card = persistedState,
            settings = updatedSettings,
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = secondReviewAtMillis
        )
        val thirdFutureSchedule = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = cardId, schedule = secondFutureSchedule),
            settings = updatedSettings,
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = thirdReviewAtMillis
        )
        val rebuiltSchedule = rebuildCardScheduleState(
            cardId = cardId,
            settings = updatedSettings,
            reviewEvents = listOf(
                FsrsReviewHistoryEvent(
                    rating = ReviewRating.GOOD,
                    reviewedAtMillis = firstReviewAtMillis
                ),
                FsrsReviewHistoryEvent(
                    rating = ReviewRating.AGAIN,
                    reviewedAtMillis = secondReviewAtMillis
                ),
                FsrsReviewHistoryEvent(
                    rating = ReviewRating.AGAIN,
                    reviewedAtMillis = thirdReviewAtMillis
                )
            )
        )

        assertEquals(thirdReviewAtMillis, thirdFutureSchedule.fsrsLastReviewedAtMillis)
        assertNotEquals(
            unexpected = thirdFutureSchedule.dueAtMillis,
            actual = rebuiltSchedule.dueAtMillis,
            message = "Rebuilt dueAt must differ when settings change after persistence."
        )
        assertNotEquals(
            unexpected = thirdFutureSchedule.fsrsCardState,
            actual = rebuiltSchedule.fsrsCardState,
            message = "Rebuilt card state must differ when settings change after persistence."
        )
        assertNotEquals(
            unexpected = thirdFutureSchedule.lapses,
            actual = rebuiltSchedule.lapses,
            message = "Rebuilt lapses must differ when settings change after persistence."
        )
    }

    @Test
    fun utcDayBoundariesUseUtcCalendarDays() {
        val schedule = computeReviewSchedule(
            card = ReviewableCardScheduleState(
                cardId = "utc-boundary-card",
                reps = 1,
                lapses = 0,
                fsrsCardState = FsrsCardState.REVIEW,
                fsrsStepIndex = null,
                fsrsStability = 8.2956,
                fsrsDifficulty = 1.0,
                fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T23:30:00.000Z"),
                fsrsScheduledDays = 8
            ),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-09T00:10:00.000Z")
        )

        assertEquals("2026-03-22T00:10:00.000Z", formatFixtureTimestamp(schedule.dueAtMillis))
        assertEquals(2, schedule.reps)
        assertEquals(0, schedule.lapses)
        assertEquals(13.48506225, schedule.fsrsStability)
        assertEquals(13, schedule.fsrsScheduledDays)
    }

    @Test
    fun sameDayHardLowersShortTermStability() {
        val schedule = computeReviewSchedule(
            card = ReviewableCardScheduleState(
                cardId = "short-term-hard-card",
                reps = 1,
                lapses = 0,
                fsrsCardState = FsrsCardState.LEARNING,
                fsrsStepIndex = 1,
                fsrsStability = 2.3065,
                fsrsDifficulty = 2.11810397,
                fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z"),
                fsrsScheduledDays = 0
            ),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.HARD,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:10:00.000Z")
        )

        assertEquals(1.33337872, schedule.fsrsStability)
        assertEquals(4.75285849, schedule.fsrsDifficulty)
    }

    @Test
    fun reviewFailureRelearningSequenceMatchesOfficialTsFsrs523() {
        val firstAgain = computeReviewSchedule(
            card = ReviewableCardScheduleState(
                cardId = "official-relearning-card",
                reps = 54,
                lapses = 8,
                fsrsCardState = FsrsCardState.REVIEW,
                fsrsStepIndex = null,
                fsrsStability = 76.50524045,
                fsrsDifficulty = 9.7990791,
                fsrsLastReviewedAtMillis = parseFixtureTimestamp("2036-06-15T00:27:00.000Z"),
                fsrsScheduledDays = 72
            ),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2036-07-12T23:33:00.000Z")
        )
        assertEquals(2.96872958, firstAgain.fsrsStability)
        assertEquals(9.91918704, firstAgain.fsrsDifficulty)

        val secondAgain = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "official-relearning-card", schedule = firstAgain),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2036-07-18T23:55:00.000Z")
        )
        val hardRelearning = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "official-relearning-card", schedule = secondAgain),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.HARD,
            reviewedAtMillis = parseFixtureTimestamp("2036-07-25T18:11:00.000Z")
        )
        val easyGraduation = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "official-relearning-card", schedule = hardRelearning),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.EASY,
            reviewedAtMillis = parseFixtureTimestamp("2036-07-27T18:37:00.000Z")
        )
        val finalReview = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "official-relearning-card", schedule = easyGraduation),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.EASY,
            reviewedAtMillis = parseFixtureTimestamp("2036-09-03T07:47:00.000Z")
        )

        assertEquals("2036-09-12T07:47:00.000Z", formatFixtureTimestamp(finalReview.dueAtMillis))
        assertEquals(6.82018621, finalReview.fsrsStability)
        assertEquals(9, finalReview.fsrsScheduledDays)
    }

    @Test
    fun learningGoodFromTheFirstShortTermStepGraduatesToReview() {
        val againSchedule = computeReviewSchedule(
            card = createEmptyReviewableCardScheduleState(cardId = "learning-again-good-card"),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
        )
        val afterAgain = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "learning-again-good-card", schedule = againSchedule),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:01:00.000Z")
        )
        assertEquals("2026-03-09T09:01:00.000Z", formatFixtureTimestamp(afterAgain.dueAtMillis))
        assertEquals(FsrsCardState.REVIEW, afterAgain.fsrsCardState)
        assertEquals(null, afterAgain.fsrsStepIndex)
        assertEquals(1, afterAgain.fsrsScheduledDays)

        val hardSchedule = computeReviewSchedule(
            card = createEmptyReviewableCardScheduleState(cardId = "learning-hard-good-card"),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.HARD,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
        )
        val afterHard = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "learning-hard-good-card", schedule = hardSchedule),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.GOOD,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:06:00.000Z")
        )
        assertEquals("2026-03-09T09:06:00.000Z", formatFixtureTimestamp(afterHard.dueAtMillis))
        assertEquals(FsrsCardState.REVIEW, afterHard.fsrsCardState)
        assertEquals(null, afterHard.fsrsStepIndex)
        assertEquals(1, afterHard.fsrsScheduledDays)
    }

    @Test
    fun backwardsTimestampsThrowDuringDirectScheduling() {
        assertFailsWithMessage(
            expectedMessage = "Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:00:00.000Z, now=2026-03-08T08:59:00.000Z"
        ) {
            computeReviewSchedule(
                card = ReviewableCardScheduleState(
                    cardId = "backwards-direct-card",
                    reps = 1,
                    lapses = 0,
                    fsrsCardState = FsrsCardState.REVIEW,
                    fsrsStepIndex = null,
                    fsrsStability = 8.2956,
                    fsrsDifficulty = 1.0,
                    fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-09T09:00:00.000Z"),
                    fsrsScheduledDays = 8
                ),
                settings = defaultSchedulerSettings(),
                rating = ReviewRating.GOOD,
                reviewedAtMillis = parseFixtureTimestamp("2026-03-08T08:59:00.000Z")
            )
        }
    }

    @Test
    fun backwardsTimestampsThrowDuringRebuild() {
        assertFailsWithMessage(
            expectedMessage = "Review timestamp moved backwards: lastReviewedAt=2026-03-09T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
        ) {
            rebuildCardScheduleState(
                cardId = "backwards-rebuild-card",
                settings = defaultSchedulerSettings(),
                reviewEvents = listOf(
                    FsrsReviewHistoryEvent(
                        rating = ReviewRating.GOOD,
                        reviewedAtMillis = parseFixtureTimestamp("2026-03-09T09:10:00.000Z")
                    ),
                    FsrsReviewHistoryEvent(
                        rating = ReviewRating.GOOD,
                        reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
                    )
                )
            )
        }
    }

    @Test
    fun sameDayBackwardsTimestampsThrowDuringDirectScheduling() {
        assertFailsWithMessage(
            expectedMessage = "Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
        ) {
            computeReviewSchedule(
                card = ReviewableCardScheduleState(
                    cardId = "same-day-backwards-direct-card",
                    reps = 1,
                    lapses = 0,
                    fsrsCardState = FsrsCardState.REVIEW,
                    fsrsStepIndex = null,
                    fsrsStability = 8.2956,
                    fsrsDifficulty = 1.0,
                    fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:10:00.000Z"),
                    fsrsScheduledDays = 8
                ),
                settings = defaultSchedulerSettings(),
                rating = ReviewRating.GOOD,
                reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
            )
        }
    }

    @Test
    fun sameDayBackwardsTimestampsThrowDuringRebuild() {
        assertFailsWithMessage(
            expectedMessage = "Review timestamp moved backwards: lastReviewedAt=2026-03-08T09:10:00.000Z, now=2026-03-08T09:00:00.000Z"
        ) {
            rebuildCardScheduleState(
                cardId = "same-day-backwards-rebuild-card",
                settings = defaultSchedulerSettings(),
                reviewEvents = listOf(
                    FsrsReviewHistoryEvent(
                        rating = ReviewRating.GOOD,
                        reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:10:00.000Z")
                    ),
                    FsrsReviewHistoryEvent(
                        rating = ReviewRating.GOOD,
                        reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
                    )
                )
            )
        }
    }

    @Test
    fun againUpdatesRepsAndLapsesWithOfficialSemantics() {
        val newAgain = computeReviewSchedule(
            card = createEmptyReviewableCardScheduleState(cardId = "counter-new-card"),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
        )
        assertEquals(1, newAgain.reps)
        assertEquals(0, newAgain.lapses)

        val learningAgain = computeReviewSchedule(
            card = makeStateFromSchedule(cardId = "counter-learning-card", schedule = newAgain),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:01:00.000Z")
        )
        assertEquals(2, learningAgain.reps)
        assertEquals(0, learningAgain.lapses)

        val reviewAgain = computeReviewSchedule(
            card = ReviewableCardScheduleState(
                cardId = "counter-review-card",
                reps = 1,
                lapses = 0,
                fsrsCardState = FsrsCardState.REVIEW,
                fsrsStepIndex = null,
                fsrsStability = 8.2956,
                fsrsDifficulty = 1.0,
                fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z"),
                fsrsScheduledDays = 8
            ),
            settings = defaultSchedulerSettings(),
            rating = ReviewRating.AGAIN,
            reviewedAtMillis = parseFixtureTimestamp("2026-03-16T09:00:00.000Z")
        )
        assertEquals(2, reviewAgain.reps)
        assertEquals(1, reviewAgain.lapses)
    }

    @Test
    fun newCardsMustNotPersistFsrsState() {
        assertFailsWithMessage(expectedMessage = "New card must not have persisted FSRS state") {
            computeReviewSchedule(
                card = ReviewableCardScheduleState(
                    cardId = "invalid-new-card",
                    reps = 0,
                    lapses = 0,
                    fsrsCardState = FsrsCardState.NEW,
                    fsrsStepIndex = null,
                    fsrsStability = 1.0,
                    fsrsDifficulty = null,
                    fsrsLastReviewedAtMillis = null,
                    fsrsScheduledDays = null
                ),
                settings = defaultSchedulerSettings(),
                rating = ReviewRating.GOOD,
                reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z")
            )
        }
    }

    @Test
    fun reviewCardsMustNotPersistStepIndex() {
        assertFailsWithMessage(expectedMessage = "Review card must not persist fsrsStepIndex") {
            computeReviewSchedule(
                card = ReviewableCardScheduleState(
                    cardId = "invalid-review-step-card",
                    reps = 1,
                    lapses = 0,
                    fsrsCardState = FsrsCardState.REVIEW,
                    fsrsStepIndex = 0,
                    fsrsStability = 8.2956,
                    fsrsDifficulty = 1.0,
                    fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z"),
                    fsrsScheduledDays = 8
                ),
                settings = defaultSchedulerSettings(),
                rating = ReviewRating.GOOD,
                reviewedAtMillis = parseFixtureTimestamp("2026-03-16T09:00:00.000Z")
            )
        }
    }

    @Test
    fun learningAndRelearningCardsMustPersistStepIndex() {
        assertFailsWithMessage(expectedMessage = "Learning or relearning card is missing fsrsStepIndex") {
            computeReviewSchedule(
                card = ReviewableCardScheduleState(
                    cardId = "invalid-learning-step-card",
                    reps = 1,
                    lapses = 0,
                    fsrsCardState = FsrsCardState.LEARNING,
                    fsrsStepIndex = null,
                    fsrsStability = 2.3065,
                    fsrsDifficulty = 2.11810397,
                    fsrsLastReviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:00:00.000Z"),
                    fsrsScheduledDays = 0
                ),
                settings = defaultSchedulerSettings(),
                rating = ReviewRating.GOOD,
                reviewedAtMillis = parseFixtureTimestamp("2026-03-08T09:10:00.000Z")
            )
        }
    }

    private fun defaultSchedulerSettings(): WorkspaceSchedulerSettings {
        return makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "workspace-local",
            updatedAtMillis = 100L
        )
    }

    private fun loadFixtures(): List<Fixture> {
        val inputStream = requireNotNull(javaClass.classLoader?.getResourceAsStream("fsrs-full-vectors.json")) {
            "Missing shared FSRS fixture resource."
        }
        val payload = inputStream.bufferedReader().use { reader ->
            reader.readText()
        }
        val fixtures = JSONArray(payload)

        return buildList {
            for (index in 0 until fixtures.length()) {
                add(parseFixture(fixtures.getJSONObject(index)))
            }
        }
    }

    private fun parseFixture(jsonObject: JSONObject): Fixture {
        return Fixture(
            name = jsonObject.getString("name"),
            cardId = jsonObject.getString("cardId"),
            settings = parseSettings(jsonObject.getJSONObject("settings")),
            reviews = parseReviews(jsonObject.getJSONArray("reviews")),
            expected = parseExpected(jsonObject.getJSONObject("expected")),
            rebuiltExpected = parseExpected(jsonObject.getJSONObject("rebuiltExpected"))
        )
    }

    private fun parseSettings(jsonObject: JSONObject): WorkspaceSchedulerSettings {
        return validateWorkspaceSchedulerSettingsInput(
            workspaceId = "workspace-local",
            desiredRetention = jsonObject.getDouble("desiredRetention"),
            learningStepsMinutes = parseIntList(jsonObject.getJSONArray("learningStepsMinutes")),
            relearningStepsMinutes = parseIntList(jsonObject.getJSONArray("relearningStepsMinutes")),
            maximumIntervalDays = jsonObject.getInt("maximumIntervalDays"),
            enableFuzz = jsonObject.getBoolean("enableFuzz"),
            updatedAtMillis = 0L
        )
    }

    private fun parseReviews(jsonArray: JSONArray): List<ReviewVector> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                val reviewObject = jsonArray.getJSONObject(index)
                add(
                    ReviewVector(
                        rating = parseReviewRating(reviewObject.getInt("rating")),
                        reviewedAtMillis = parseFixtureTimestamp(reviewObject.getString("at"))
                    )
                )
            }
        }
    }

    private fun parseExpected(jsonObject: JSONObject): ExpectedSchedule {
        return ExpectedSchedule(
            dueAt = jsonObject.optString("dueAt").takeIf { value -> value.isNotEmpty() },
            reps = jsonObject.getInt("reps"),
            lapses = jsonObject.getInt("lapses"),
            fsrsCardState = parseFsrsCardState(jsonObject.getString("fsrsCardState")),
            fsrsStepIndex = if (jsonObject.isNull("fsrsStepIndex")) {
                null
            } else {
                jsonObject.getInt("fsrsStepIndex")
            },
            fsrsStability = if (jsonObject.isNull("fsrsStability")) {
                null
            } else {
                jsonObject.getDouble("fsrsStability")
            },
            fsrsDifficulty = if (jsonObject.isNull("fsrsDifficulty")) {
                null
            } else {
                jsonObject.getDouble("fsrsDifficulty")
            },
            fsrsLastReviewedAt = jsonObject.optString("fsrsLastReviewedAt").takeIf { value -> value.isNotEmpty() },
            fsrsScheduledDays = if (jsonObject.isNull("fsrsScheduledDays")) {
                null
            } else {
                jsonObject.getInt("fsrsScheduledDays")
            }
        )
    }

    private fun parseIntList(jsonArray: JSONArray): List<Int> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                add(jsonArray.getInt(index))
            }
        }
    }

    private fun parseReviewRating(rawValue: Int): ReviewRating {
        return when (rawValue) {
            0 -> ReviewRating.AGAIN
            1 -> ReviewRating.HARD
            2 -> ReviewRating.GOOD
            3 -> ReviewRating.EASY
            else -> throw IllegalArgumentException("Unsupported review rating: $rawValue")
        }
    }

    private fun parseFsrsCardState(rawValue: String): FsrsCardState {
        return when (rawValue) {
            "new" -> FsrsCardState.NEW
            "learning" -> FsrsCardState.LEARNING
            "review" -> FsrsCardState.REVIEW
            "relearning" -> FsrsCardState.RELEARNING
            else -> throw IllegalArgumentException("Unsupported FSRS card state: $rawValue")
        }
    }

    private fun makeStateFromSchedule(cardId: String, schedule: ReviewSchedule): ReviewableCardScheduleState {
        return ReviewableCardScheduleState(
            cardId = cardId,
            reps = schedule.reps,
            lapses = schedule.lapses,
            fsrsCardState = schedule.fsrsCardState,
            fsrsStepIndex = schedule.fsrsStepIndex,
            fsrsStability = schedule.fsrsStability,
            fsrsDifficulty = schedule.fsrsDifficulty,
            fsrsLastReviewedAtMillis = schedule.fsrsLastReviewedAtMillis,
            fsrsScheduledDays = schedule.fsrsScheduledDays
        )
    }

    private fun toExpectedSchedule(schedule: ReviewSchedule?): ExpectedSchedule {
        if (schedule == null) {
            return ExpectedSchedule(
                dueAt = null,
                reps = 0,
                lapses = 0,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAt = null,
                fsrsScheduledDays = null
            )
        }

        return ExpectedSchedule(
            dueAt = formatFixtureTimestamp(schedule.dueAtMillis),
            reps = schedule.reps,
            lapses = schedule.lapses,
            fsrsCardState = schedule.fsrsCardState,
            fsrsStepIndex = schedule.fsrsStepIndex,
            fsrsStability = schedule.fsrsStability,
            fsrsDifficulty = schedule.fsrsDifficulty,
            fsrsLastReviewedAt = formatFixtureTimestamp(schedule.fsrsLastReviewedAtMillis),
            fsrsScheduledDays = schedule.fsrsScheduledDays
        )
    }

    private fun toExpectedSchedule(rebuilt: RebuiltCardScheduleState): ExpectedSchedule {
        return ExpectedSchedule(
            dueAt = formatFixtureTimestamp(rebuilt.dueAtMillis),
            reps = rebuilt.reps,
            lapses = rebuilt.lapses,
            fsrsCardState = rebuilt.fsrsCardState,
            fsrsStepIndex = rebuilt.fsrsStepIndex,
            fsrsStability = rebuilt.fsrsStability,
            fsrsDifficulty = rebuilt.fsrsDifficulty,
            fsrsLastReviewedAt = formatFixtureTimestamp(rebuilt.fsrsLastReviewedAtMillis),
            fsrsScheduledDays = rebuilt.fsrsScheduledDays
        )
    }

    private fun assertExpectedSchedule(
        actual: ExpectedSchedule,
        expected: ExpectedSchedule,
        message: String
    ) {
        assertEquals("$message dueAt", expected.dueAt, actual.dueAt)
        assertEquals("$message reps", expected.reps, actual.reps)
        assertEquals("$message lapses", expected.lapses, actual.lapses)
        assertEquals("$message state", expected.fsrsCardState, actual.fsrsCardState)
        assertEquals("$message stepIndex", expected.fsrsStepIndex, actual.fsrsStepIndex)
        assertEquals("$message stability", expected.fsrsStability, actual.fsrsStability)
        assertEquals("$message difficulty", expected.fsrsDifficulty, actual.fsrsDifficulty)
        assertEquals("$message lastReviewedAt", expected.fsrsLastReviewedAt, actual.fsrsLastReviewedAt)
        assertEquals("$message scheduledDays", expected.fsrsScheduledDays, actual.fsrsScheduledDays)
    }

    private fun assertFailsWithMessage(expectedMessage: String, block: () -> Unit) {
        try {
            block()
            fail("Expected failure with message: $expectedMessage")
        } catch (error: IllegalArgumentException) {
            assertEquals(expectedMessage, error.message)
        }
    }

    private fun assertNotEquals(unexpected: Any?, actual: Any?, message: String) {
        if (unexpected == actual) {
            fail(message)
        }
    }

    private fun parseFixtureTimestamp(value: String): Long {
        return Instant.parse(value).toEpochMilli()
    }

    private fun formatFixtureTimestamp(value: Long?): String? {
        return value?.let { timestampMillis ->
            fixtureTimestampFormatter.format(Instant.ofEpochMilli(timestampMillis))
        }
    }

    private data class Fixture(
        val name: String,
        val cardId: String,
        val settings: WorkspaceSchedulerSettings,
        val reviews: List<ReviewVector>,
        val expected: ExpectedSchedule,
        val rebuiltExpected: ExpectedSchedule
    )

    private data class ReviewVector(
        val rating: ReviewRating,
        val reviewedAtMillis: Long
    )

    private data class ExpectedSchedule(
        val dueAt: String?,
        val reps: Int,
        val lapses: Int,
        val fsrsCardState: FsrsCardState,
        val fsrsStepIndex: Int?,
        val fsrsStability: Double?,
        val fsrsDifficulty: Double?,
        val fsrsLastReviewedAt: String?,
        val fsrsScheduledDays: Int?
    )

    companion object {
        private val fixtureTimestampFormatter: DateTimeFormatter = DateTimeFormatter
            .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US)
            .withZone(ZoneOffset.UTC)
    }
}
