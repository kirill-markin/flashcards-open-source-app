package com.flashcardsopensourceapp.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.MainActivity
import com.flashcardsopensourceapp.app.R

class ReviewNotificationWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (hasNotificationPermission(context = applicationContext).not()) {
            return Result.success()
        }

        ensureNotificationChannel(context = applicationContext)

        val workspaceId = inputData.getString(reviewNotificationWorkspaceIdDataKey)
            ?: return Result.failure()
        val cardId = inputData.getString(reviewNotificationCardIdDataKey)
            ?: return Result.failure()
        val frontText = inputData.getString(reviewNotificationFrontTextDataKey)
            ?: return Result.failure()
        val requestId = inputData.getString(reviewNotificationRequestIdDataKey)
            ?: return Result.failure()
        val filterKind = inputData.getString(reviewNotificationFilterKindDataKey)
            ?: return Result.failure()

        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey", workspaceId)
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationCardIdDataKey", cardId)
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFrontTextDataKey", frontText)
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationRequestIdDataKey", requestId)
            putExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFilterKindDataKey", filterKind)
            putExtra(
                "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterDeckIdDataKey",
                inputData.getString(reviewNotificationFilterDeckIdDataKey)
            )
            putExtra(
                "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterTagDataKey",
                inputData.getString(reviewNotificationFilterTagDataKey)
            )
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            requestId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val appName = applicationContext.getString(R.string.app_name)
        val notification = NotificationCompat.Builder(applicationContext, reviewNotificationChannelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(appName)
            .setContentText(frontText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(frontText))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        NotificationManagerCompat.from(applicationContext).notify(requestId.hashCode(), notification)
        return Result.success()
    }
}

private fun ensureNotificationChannel(context: Context) {
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
