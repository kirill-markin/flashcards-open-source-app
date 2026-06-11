package com.flashcardsopensourceapp.app.notifications

import android.content.Intent
import android.util.Log

const val appNotificationTapTypeDataKey: String = "notificationType"
const val appNotificationTapExtraPrefix: String = "app-notification-extra"

val appNotificationTapIntentExtraKeys: List<String> = listOf(
    "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey"
)

enum class AppNotificationTapType(
    val rawValue: String
) {
    REVIEW_REMINDER(rawValue = "reviewReminder"),
    STRICT_REMINDER(rawValue = "strictReminder");

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

internal const val appNotificationLogTag: String = "FlashcardsAppNotification"

fun logAppNotificationTapFallback(fallback: AppNotificationTapFallback) {
    val message = buildAppNotificationTapLogMessage(fallback = fallback)
    try {
        Log.e(appNotificationLogTag, message)
    } catch (error: RuntimeException) {
        System.err.println(message)
    }
}

private fun buildAppNotificationTapLogMessage(fallback: AppNotificationTapFallback): String {
    val notificationType = fallback.notificationType ?: "null"
    val details = fallback.details ?: "null"
    return "domain=android_notifications action=notification_tap_fallback " +
        "stage=${fallback.stage} reason=${fallback.reason} " +
        "notificationType=$notificationType details=$details"
}

internal fun parseAppNotificationTapRequest(
    getStringExtra: (String) -> String?
): AppNotificationTapRequest? {
    val rawNotificationType = getStringExtra("$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey")
        ?: return null
    val notificationType = AppNotificationTapType.fromRawValue(rawValue = rawNotificationType)
    if (notificationType == null) {
        logAppNotificationTapFallback(
            fallback = AppNotificationTapFallback(
                stage = "parse",
                reason = "unsupported_notification_type",
                notificationType = rawNotificationType,
                details = null
            )
        )
        return null
    }

    return AppNotificationTapRequest(type = notificationType)
}

fun parseAppNotificationTapRequest(intent: Intent): AppNotificationTapRequest? {
    return parseAppNotificationTapRequest(getStringExtra = intent::getStringExtra)
}

internal fun consumeAppNotificationTapRequest(
    getStringExtra: (String) -> String?,
    removeExtra: (String) -> Unit
): AppNotificationTapRequest? {
    val request = parseAppNotificationTapRequest(getStringExtra = getStringExtra) ?: return null
    clearAppNotificationTapExtras(removeExtra = removeExtra)
    return request
}

fun consumeAppNotificationTapRequest(intent: Intent): AppNotificationTapRequest? {
    return consumeAppNotificationTapRequest(
        getStringExtra = intent::getStringExtra,
        removeExtra = intent::removeExtra
    )
}

private fun clearAppNotificationTapExtras(removeExtra: (String) -> Unit) {
    appNotificationTapIntentExtraKeys.forEach(removeExtra)
}
