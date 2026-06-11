package com.flashcardsopensourceapp.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.flashcardsopensourceapp.app.R

const val reviewNotificationChannelId: String = "review-reminders"

internal fun ensureReviewNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return
    }

    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(
            reviewNotificationChannelId,
            context.getString(R.string.review_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(R.string.review_notification_channel_description)
        }
    )
}
