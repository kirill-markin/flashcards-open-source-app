package com.flashcardsopensourceapp.app.notifications

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.flashcardsopensourceapp.app.MainActivity
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset
import com.flashcardsopensourceapp.feature.review.reviewTextProvider

const val strictReminderNotificationTagPrefix: String = "strict-reminder::"

data class StrictReminderNotificationContent(
    val notificationTag: String,
    val notificationId: Int,
    val notification: Notification
)

fun buildStrictReminderNotificationContent(
    context: Context,
    timeOffset: StrictReminderTimeOffset,
    requestId: String
): StrictReminderNotificationContent {
    ensureReviewNotificationChannel(context = context)
    val pendingIntent = createStrictReminderPendingIntent(
        context = context,
        requestId = requestId
    )
    val appName = context.getString(R.string.app_name)
    val body = reviewTextProvider(context = context).strictReminderBody(timeOffset = timeOffset)
    val notification = NotificationCompat.Builder(context, reviewNotificationChannelId)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(appName)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()

    return StrictReminderNotificationContent(
        notificationTag = strictReminderNotificationTag(requestId = requestId),
        notificationId = strictReminderNotificationId(requestId = requestId),
        notification = notification
    )
}

fun showStrictReminderNotification(
    context: Context,
    timeOffset: StrictReminderTimeOffset,
    requestId: String
): Int {
    if (hasNotificationPermission(context = context).not()) {
        throw SecurityException("POST_NOTIFICATIONS is not granted for package '${context.packageName}'.")
    }

    val notificationContent = buildStrictReminderNotificationContent(
        context = context,
        timeOffset = timeOffset,
        requestId = requestId
    )
    notifyStrictReminder(
        context = context,
        notificationContent = notificationContent
    )
    return notificationContent.notificationId
}

@SuppressLint("MissingPermission")
private fun notifyStrictReminder(
    context: Context,
    notificationContent: StrictReminderNotificationContent
) {
    NotificationManagerCompat.from(context).notify(
        notificationContent.notificationTag,
        notificationContent.notificationId,
        notificationContent.notification
    )
}

private fun createStrictReminderPendingIntent(
    context: Context,
    requestId: String
): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(
            "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey",
            AppNotificationTapType.STRICT_REMINDER.rawValue
        )
    }

    return PendingIntent.getActivity(
        context,
        strictReminderNotificationId(requestId = requestId),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

private fun strictReminderNotificationId(requestId: String): Int {
    return requestId.hashCode()
}

internal fun strictReminderNotificationTag(requestId: String): String {
    return "$strictReminderNotificationTagPrefix$requestId"
}
