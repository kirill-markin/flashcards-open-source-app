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

        // TODO: Port outbox drain, remote pull, and sync cursor logic from apps/ios/Flashcards/Flashcards/CloudSync.
        application.appGraph.syncRepository.scheduleDraftSync()
        return Result.success()
    }
}

fun buildSyncWorkerRequest(): OneTimeWorkRequest {
    return OneTimeWorkRequestBuilder<SyncWorker>().build()
}
