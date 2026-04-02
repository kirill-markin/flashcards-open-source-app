package com.flashcardsopensourceapp.app.notifications

import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReviewNotificationsManagerTest {
    @Test
    fun consumeReviewNotificationTapPayloadReturnsPayloadOnlyOncePerIntent() {
        val persistedFilter = makePersistedReviewFilter(reviewFilter = ReviewFilter.AllCards)
        val extras = mutableMapOf(
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

        requireNotNull(firstPayload)
        assertEquals("workspace-1", firstPayload.workspaceId)
        assertEquals("card-1", firstPayload.cardId)
        assertEquals("request-1", firstPayload.requestId)
        assertNull(secondPayload)
    }
}
