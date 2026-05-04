package com.flashcardsopensourceapp.app.notifications

import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReviewNotificationsManagerTest {
    @Test
    fun reviewReminderNotificationTagUsesDedicatedPrefix() {
        assertEquals(
            "review-notification::request-123",
            reviewReminderNotificationTag(requestId = "request-123")
        )
    }

    @Test
    fun strictReminderNotificationTagUsesDedicatedPrefix() {
        assertEquals(
            "strict-reminder::request-456",
            strictReminderNotificationTag(requestId = "request-456")
        )
    }

    @Test
    fun consumeAppNotificationTapRequestReturnsRequestOnlyOncePerIntent() {
        val extras = mutableMapOf(
            "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey" to AppNotificationTapType.REVIEW_REMINDER.rawValue
        )

        val firstPayload = consumeAppNotificationTapRequest(
            getStringExtra = extras::get,
            removeExtra = extras::remove
        )
        val secondPayload = consumeAppNotificationTapRequest(
            getStringExtra = extras::get,
            removeExtra = extras::remove
        )

        requireNotNull(firstPayload)
        assertEquals(AppNotificationTapType.REVIEW_REMINDER, firstPayload.type)
        assertNull(secondPayload)
    }

    @Test
    fun parseAppNotificationTapRequestReturnsNullForUnsupportedNotificationType() {
        val request = parseAppNotificationTapRequest(
            getStringExtra = mapOf(
                "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey" to "unsupported"
            )::get
        )

        assertNull(request)
    }

    @Test
    fun parseAppNotificationTapRequestParsesStrictReminderType() {
        val request = parseAppNotificationTapRequest(
            getStringExtra = mapOf(
                "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey" to AppNotificationTapType.STRICT_REMINDER.rawValue
            )::get
        )

        requireNotNull(request)
        assertEquals(AppNotificationTapType.STRICT_REMINDER, request.type)
    }

    @Test
    fun exactStoredReviewTagResolutionPreservesUnicodeStoredNames() {
        val exactTagNames = resolveExactStoredReviewTagNames(
            requestedTagNames = listOf("éclair", "привет"),
            storedTagNames = listOf("Éclair", "Plain", "Привет")
        )

        assertEquals(listOf("Éclair", "Привет"), exactTagNames)
    }

    @Test
    fun exactStoredReviewTagResolutionReturnsEmptyForImpossibleTagPredicate() {
        val exactTagNames = resolveExactStoredReviewTagNames(
            requestedTagNames = listOf("missing-tag"),
            storedTagNames = listOf("Éclair", "Plain")
        )

        assertEquals(emptyList<String>(), exactTagNames)
    }

    @Test
    fun directMissingTagFilterSchedulesAllCardsPlan() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tag(tag = "missing-tag"),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.AllCards),
            plan
        )
    }

    @Test
    fun directDeletedOnlyTagFilterSchedulesAllCardsFromActiveReviewTagSource() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tag(tag = "stale"),
            activeReviewTagNames = listOf("Visible"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.AllCards),
            plan
        )
    }

    @Test
    fun deckFilterWithMissingStoredTagPredicateSuppressesScheduledPayloads() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Deck(deckId = "deck-1"),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = DeckFilterDefinition(
                version = 2,
                effortLevels = emptyList(),
                tags = listOf("missing-tag")
            )
        )

        assertEquals(
            ReviewNotificationFilterPlan.SuppressScheduledPayloads,
            plan
        )
    }

    @Test
    fun missingDeckFilterSchedulesAllCardsPlan() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Deck(deckId = "missing-deck"),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.AllCards),
            plan
        )
    }

    @Test
    fun validUnicodeCaseNormalizedTagAndDeckFiltersRemainSchedulable() {
        val tagPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tag(tag = "éclair"),
            activeReviewTagNames = listOf("Éclair", "Привет"),
            selectedDeckFilterDefinition = null
        )
        val deckPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Deck(deckId = "deck-1"),
            activeReviewTagNames = listOf("Éclair", "Привет"),
            selectedDeckFilterDefinition = DeckFilterDefinition(
                version = 2,
                effortLevels = emptyList(),
                tags = listOf("привет")
            )
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.Tag(tag = "Éclair")),
            tagPlan
        )
        assertEquals(
            ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.Deck(deckId = "deck-1")),
            deckPlan
        )
    }
}
