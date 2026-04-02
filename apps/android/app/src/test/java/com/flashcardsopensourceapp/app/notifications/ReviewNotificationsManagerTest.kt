package com.flashcardsopensourceapp.app.notifications

import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import com.flashcardsopensourceapp.feature.review.ReviewNotificationTapRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReviewNotificationsManagerTest {
    @Test
    fun consumeReviewNotificationTapPayloadReturnsRequestOnlyOncePerIntent() {
        val persistedFilter = makePersistedReviewFilter(reviewFilter = ReviewFilter.AllCards)
        val extras = mutableMapOf(
            "$reviewNotificationTapExtraPrefix::$reviewNotificationTapMarkerDataKey" to reviewNotificationTapMarkerValue,
            "$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey" to "workspace-1",
            "$reviewNotificationTapExtraPrefix::$reviewNotificationCardIdDataKey" to "card-1",
            "$reviewNotificationTapExtraPrefix::$reviewNotificationFrontTextDataKey" to "Front",
            "$reviewNotificationTapExtraPrefix::$reviewNotificationRequestIdDataKey" to "request-1",
            "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterKindDataKey" to persistedFilter.kind
        )

        val firstPayload = consumeReviewNotificationTapPayload(
            getStringExtra = extras::get,
            removeExtra = extras::remove
        )
        val secondPayload = consumeReviewNotificationTapPayload(
            getStringExtra = extras::get,
            removeExtra = extras::remove
        )

        val resolvedRequest = firstPayload as ReviewNotificationTapRequest.Resolved
        assertEquals("workspace-1", resolvedRequest.payload.workspaceId)
        assertEquals("card-1", resolvedRequest.payload.cardId)
        assertEquals("request-1", resolvedRequest.payload.requestId)
        assertNull(secondPayload)
    }

    @Test
    fun parseReviewNotificationTapPayloadReturnsFallbackForMalformedNotification() {
        val request = parseReviewNotificationTapPayload(
            getStringExtra = mapOf(
                "$reviewNotificationTapExtraPrefix::$reviewNotificationTapMarkerDataKey" to reviewNotificationTapMarkerValue,
                "$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey" to "workspace-1"
            )::get
        )

        require(request is ReviewNotificationTapRequest.Fallback)
        assertEquals("parse", request.fallback.stage)
        assertEquals("missing_card_id", request.fallback.reason)
        assertEquals("workspace-1", request.fallback.workspaceId)
    }
}
