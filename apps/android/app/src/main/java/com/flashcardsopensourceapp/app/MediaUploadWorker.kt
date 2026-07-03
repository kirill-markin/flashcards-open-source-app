package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.data.local.repository.media.MediaUploadTransferRunResult
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

private const val mediaUploadWorkerName: String = "media-upload-transfer"
private const val mediaUploadWorkerTag: String = "media-upload-transfer"

class MediaUploadWorker(
    context: Context,
    workerParameters: WorkerParameters
) : CoroutineWorker(appContext = context, params = workerParameters) {
    override suspend fun doWork(): Result {
        val application = applicationContext as FlashcardsApplication

        return try {
            application.appGraph.awaitStartup()
            val runResult: MediaUploadTransferRunResult = application.appGraph.mediaUploadTransferRepository.runDueUploads()
            enqueueFollowUpMediaUploadWorkerIfNeeded(
                context = applicationContext,
                runResult = runResult
            )
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Result.retry()
        }
    }
}

fun enqueueMediaUploadWorker(
    context: Context,
    initialDelayMillis: Long
) {
    require(initialDelayMillis >= 0L) {
        "Media upload worker initialDelayMillis must not be negative."
    }
    WorkManager.getInstance(context).enqueueUniqueWork(
        mediaUploadWorkerName,
        ExistingWorkPolicy.KEEP,
        buildMediaUploadWorkerRequest(initialDelayMillis = initialDelayMillis)
    )
}

private fun enqueueFollowUpMediaUploadWorkerIfNeeded(
    context: Context,
    runResult: MediaUploadTransferRunResult
) {
    val nextAttemptAtMillis: Long = runResult.nextAttemptAtMillis ?: return
    val delayMillis: Long = (nextAttemptAtMillis - System.currentTimeMillis()).coerceAtLeast(0L)
    WorkManager.getInstance(context).enqueueUniqueWork(
        mediaUploadWorkerName,
        ExistingWorkPolicy.APPEND_OR_REPLACE,
        buildMediaUploadWorkerRequest(initialDelayMillis = delayMillis)
    )
}

private fun buildMediaUploadWorkerRequest(initialDelayMillis: Long): OneTimeWorkRequest {
    return OneTimeWorkRequestBuilder<MediaUploadWorker>()
        .setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
        )
        .setInitialDelay(initialDelayMillis, TimeUnit.MILLISECONDS)
        .addTag(mediaUploadWorkerTag)
        .build()
}
