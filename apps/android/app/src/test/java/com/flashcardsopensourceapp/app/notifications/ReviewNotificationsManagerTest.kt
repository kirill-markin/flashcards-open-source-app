package com.flashcardsopensourceapp.app.notifications

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
}
