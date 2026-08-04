package com.flashcardsopensourceapp.app.notifications

import com.flashcardsopensourceapp.app.notifications.review.ReviewNotificationFilterPlan
import com.flashcardsopensourceapp.app.notifications.review.resolveExactStoredReviewTagNames
import com.flashcardsopensourceapp.app.notifications.review.resolveReviewNotificationFilterPlan
import com.flashcardsopensourceapp.app.notifications.review.reviewReminderNotificationTag
import com.flashcardsopensourceapp.app.notifications.strict.strictReminderNotificationTag
import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
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
    fun directMissingTagFilterSuppressesScheduledPayloads() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tags(tags = listOf("missing-tag")),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.SuppressScheduledPayloads,
            plan
        )
    }

    @Test
    fun directDeletedOnlyTagFilterSuppressesScheduledPayloads() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tags(tags = listOf("stale")),
            activeReviewTagNames = listOf("Visible"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.SuppressScheduledPayloads,
            plan
        )
    }

    @Test
    fun multiTagFilterDropsMissingTagsAndCanonicalizesEveryCurrentTagToAllCards() {
        val partialPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = makeReviewTagFilter(tagNames = listOf("Éclair", "missing")),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = null
        )
        val allTagsPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = makeReviewTagFilter(tagNames = listOf("Éclair", "Plain")),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = null
        )
        val missingPlusEveryRemainingTagPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = makeReviewTagFilter(tagNames = listOf("Éclair", "missing")),
            activeReviewTagNames = listOf("Éclair"),
            selectedDeckFilterDefinition = null
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.Tags(tags = listOf("Éclair")),
                payloadReviewFilter = makeReviewTagFilter(tagNames = listOf("Éclair", "missing"))
            ),
            partialPlan
        )
        assertEquals(
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.AllCards,
                payloadReviewFilter = ReviewFilter.AllCards
            ),
            allTagsPlan
        )
        assertEquals(
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.Tags(tags = listOf("Éclair")),
                payloadReviewFilter = makeReviewTagFilter(tagNames = listOf("Éclair", "missing"))
            ),
            missingPlusEveryRemainingTagPlan
        )
    }

    @Test
    fun deckFilterWithMissingStoredTagPredicateSuppressesScheduledPayloads() {
        val plan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Deck(deckId = "deck-1"),
            activeReviewTagNames = listOf("Éclair", "Plain"),
            selectedDeckFilterDefinition = DeckFilterDefinition(
                version = 2,
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
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.AllCards,
                payloadReviewFilter = ReviewFilter.AllCards
            ),
            plan
        )
    }

    @Test
    fun validUnicodeCaseNormalizedTagAndDeckFiltersRemainSchedulable() {
        val tagPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Tags(tags = listOf("éclair")),
            activeReviewTagNames = listOf("Éclair", "Привет"),
            selectedDeckFilterDefinition = null
        )
        val deckPlan: ReviewNotificationFilterPlan = resolveReviewNotificationFilterPlan(
            selectedReviewFilter = ReviewFilter.Deck(deckId = "deck-1"),
            activeReviewTagNames = listOf("Éclair", "Привет"),
            selectedDeckFilterDefinition = DeckFilterDefinition(
                version = 2,
                tags = listOf("привет")
            )
        )

        assertEquals(
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.Tags(tags = listOf("Éclair")),
                payloadReviewFilter = ReviewFilter.Tags(tags = listOf("éclair"))
            ),
            tagPlan
        )
        assertEquals(
            ReviewNotificationFilterPlan.Schedule(
                queryReviewFilter = ReviewFilter.Deck(deckId = "deck-1"),
                payloadReviewFilter = ReviewFilter.Deck(deckId = "deck-1")
            ),
            deckPlan
        )
    }
}
