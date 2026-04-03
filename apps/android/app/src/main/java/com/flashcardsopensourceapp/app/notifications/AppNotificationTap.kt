package com.flashcardsopensourceapp.app.notifications

import android.util.Log
import org.json.JSONObject

const val appNotificationTapTypeDataKey: String = "notificationType"
const val appNotificationTapExtraPrefix: String = "app-notification-extra"

val appNotificationTapIntentExtraKeys: List<String> = listOf(
    "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey"
)

enum class AppNotificationTapType(
    val rawValue: String
) {
    REVIEW_REMINDER(rawValue = "reviewReminder");

    companion object {
        fun fromRawValue(rawValue: String): AppNotificationTapType? {
            return entries.firstOrNull { entry ->
                entry.rawValue == rawValue
            }
        }
    }
}

data class AppNotificationTapRequest(
    val type: AppNotificationTapType
)

data class AppNotificationTapFallback(
    val stage: String,
    val reason: String,
    val notificationType: String?,
    val details: String?
)

private const val appNotificationLogTag: String = "FlashcardsAppNotification"

fun logAppNotificationTapFallback(fallback: AppNotificationTapFallback) {
    val record = JSONObject().apply {
        put("domain", "android_notifications")
        put("action", "notification_tap_fallback")
        put("stage", fallback.stage)
        put("reason", fallback.reason)
        put("notificationType", fallback.notificationType)
        put("details", fallback.details)
    }
    Log.e(appNotificationLogTag, record.toString())
}
