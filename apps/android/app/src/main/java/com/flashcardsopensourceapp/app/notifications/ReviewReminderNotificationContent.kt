package com.flashcardsopensourceapp.app.notifications

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.flashcardsopensourceapp.app.MainActivity
import com.flashcardsopensourceapp.app.R

data class ReviewReminderNotificationContent(
    val notificationId: Int,
    val notification: Notification
)

fun buildReviewReminderNotificationContent(
    context: Context,
    frontText: String,
    requestId: String
): ReviewReminderNotificationContent {
    ensureReviewNotificationChannel(context = context)
    val pendingIntent = createReviewReminderPendingIntent(
        context = context,
        requestId = requestId
    )
    val appName = context.getString(R.string.app_name)
    val notification = NotificationCompat.Builder(context, reviewNotificationChannelId)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(appName)
        .setContentText(frontText)
        .setStyle(NotificationCompat.BigTextStyle().bigText(frontText))
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()

    return ReviewReminderNotificationContent(
        notificationId = reviewReminderNotificationId(requestId = requestId),
        notification = notification
    )
}

fun showReviewReminderNotification(
    context: Context,
    frontText: String,
    requestId: String
): Int {
    if (hasNotificationPermission(context = context).not()) {
        throw SecurityException("POST_NOTIFICATIONS is not granted for package '${context.packageName}'.")
    }

    val notificationContent = buildReviewReminderNotificationContent(
        context = context,
        frontText = frontText,
        requestId = requestId
    )
    notifyReviewReminder(
        context = context,
        notificationContent = notificationContent
    )
    return notificationContent.notificationId
}

@SuppressLint("MissingPermission")
private fun notifyReviewReminder(
    context: Context,
    notificationContent: ReviewReminderNotificationContent
) {
    NotificationManagerCompat.from(context).notify(
        notificationContent.notificationId,
        notificationContent.notification
    )
}

private fun createReviewReminderPendingIntent(
    context: Context,
    requestId: String
): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(
            "$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey",
            AppNotificationTapType.REVIEW_REMINDER.rawValue
        )
    }

    return PendingIntent.getActivity(
        context,
        reviewReminderNotificationId(requestId = requestId),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

private fun reviewReminderNotificationId(requestId: String): Int {
    return requestId.hashCode()
}

private fun ensureReviewNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return
    }

    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(reviewNotificationChannelId) != null) {
        return
    }

    manager.createNotificationChannel(
        NotificationChannel(
            reviewNotificationChannelId,
            "Review reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Study reminders with cards from your review queue."
        }
    )
}
