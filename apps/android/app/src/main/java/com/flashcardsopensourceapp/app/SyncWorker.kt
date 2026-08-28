package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkerParameters
import com.flashcardsopensourceapp.app.analytics.analyticsSyncFailureReason

class SyncWorker(
    context: Context,
    workerParameters: WorkerParameters
) : CoroutineWorker(appContext = context, params = workerParameters) {
    override suspend fun doWork(): Result {
        val application = applicationContext as FlashcardsApplication

        return try {
            application.appGraph.syncRepository.scheduleSync()
            runCatching {
                application.appGraph.syncFailureAnalyticsReporter.reportSuccess()
            }
            Result.success()
        } catch (error: Exception) {
            // WorkManager retries this worker on its own backoff, so the report is gated on the
            // transition into failure: one event per failure episode, not one per attempt.
            runCatching {
                application.appGraph.syncFailureAnalyticsReporter.reportFailure(
                    reason = analyticsSyncFailureReason(error = error)
                )
            }
            Result.retry()
        }
    }
}

fun buildSyncWorkerRequest(): OneTimeWorkRequest {
    return OneTimeWorkRequestBuilder<SyncWorker>().build()
}
