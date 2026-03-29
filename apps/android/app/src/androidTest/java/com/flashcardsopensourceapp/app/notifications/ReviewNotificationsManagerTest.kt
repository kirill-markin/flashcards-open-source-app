package com.flashcardsopensourceapp.app.notifications

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewNotificationsManagerTest {
    @Test
    fun consumeReviewNotificationTapPayloadReturnsPayloadOnlyOncePerIntent() {
        val intent = Intent().apply {
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey", "workspace-1")
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationCardIdDataKey", "card-1")
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFrontTextDataKey", "Front")
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationRequestIdDataKey", "request-1")
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFilterKindDataKey", "all_cards")
        }

        val firstPayload = consumeReviewNotificationTapPayload(intent = intent)
        val secondPayload = consumeReviewNotificationTapPayload(intent = intent)

        requireNotNull(firstPayload)
        assertEquals("workspace-1", firstPayload.workspaceId)
        assertEquals("card-1", firstPayload.cardId)
        assertEquals("request-1", firstPayload.requestId)
        assertNull(secondPayload)
    }
}
