package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkerParameters

class SyncWorker(
    context: Context,
    workerParameters: WorkerParameters
) : CoroutineWorker(appContext = context, params = workerParameters) {
    override suspend fun doWork(): Result {
        val application = applicationContext as FlashcardsApplication

        return try {
            application.appGraph.syncRepository.scheduleSync()
            Result.success()
        } catch (error: Exception) {
            Result.retry()
        }
    }
}

fun buildSyncWorkerRequest(): OneTimeWorkRequest {
    return OneTimeWorkRequestBuilder<SyncWorker>().build()
}
