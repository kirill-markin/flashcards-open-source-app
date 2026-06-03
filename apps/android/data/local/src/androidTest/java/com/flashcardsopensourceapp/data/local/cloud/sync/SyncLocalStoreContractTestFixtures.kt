package com.flashcardsopensourceapp.data.local.cloud.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.encodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore

internal const val syncLocalStoreContractWorkspaceId: String = "workspace-1"

internal data class SyncLocalStoreTestRuntime(
    val context: Context,
    val database: AppDatabase,
    val preferencesStore: CloudPreferencesStore,
    val reviewPreferencesStore: ReviewPreferencesStore,
    val syncLocalStore: SyncLocalStore
)

internal fun createSyncLocalStoreTestRuntime(): SyncLocalStoreTestRuntime {
    val context: Context = ApplicationProvider.getApplicationContext()
    clearSyncLocalStoreSharedPreferences(context = context)
    val database: AppDatabase = Room.inMemoryDatabaseBuilder(
        context = context,
        klass = AppDatabase::class.java
    ).allowMainThreadQueries().build()
    val preferencesStore: CloudPreferencesStore = CloudPreferencesStore(context = context, database = database)
    val reviewPreferencesStore: ReviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context)
    val syncLocalStore: SyncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = preferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        localProgressCacheStore = LocalProgressCacheStore(
            database = database,
            timeProvider = SystemTimeProvider
        ),
        timeProvider = SystemTimeProvider
    )

    return SyncLocalStoreTestRuntime(
        context = context,
        database = database,
        preferencesStore = preferencesStore,
        reviewPreferencesStore = reviewPreferencesStore,
        syncLocalStore = syncLocalStore
    )
}

internal fun closeSyncLocalStoreTestRuntime(runtime: SyncLocalStoreTestRuntime): Unit {
    runtime.database.close()
    clearSyncLocalStoreSharedPreferences(context = runtime.context)
}

internal suspend fun insertSyncContractWorkspaceShell(
    database: AppDatabase,
    workspaceId: String
): Unit {
    database.workspaceDao().insertWorkspace(
        WorkspaceEntity(
            workspaceId = workspaceId,
            name = "Workspace",
            createdAtMillis = 1L
        )
    )
    val settings: WorkspaceSchedulerSettings = makeDefaultWorkspaceSchedulerSettings(
        workspaceId = workspaceId,
        updatedAtMillis = 1L
    )
    database.workspaceSchedulerSettingsDao().insertWorkspaceSchedulerSettings(
        WorkspaceSchedulerSettingsEntity(
            workspaceId = settings.workspaceId,
            algorithm = settings.algorithm,
            desiredRetention = settings.desiredRetention,
            learningStepsMinutesJson = encodeSchedulerStepListJson(settings.learningStepsMinutes),
            relearningStepsMinutesJson = encodeSchedulerStepListJson(settings.relearningStepsMinutes),
            maximumIntervalDays = settings.maximumIntervalDays,
            enableFuzz = settings.enableFuzz,
            updatedAtMillis = settings.updatedAtMillis
        )
    )
}

internal suspend fun insertSyncContractCard(
    database: AppDatabase,
    workspaceId: String,
    cardId: String
): Unit {
    database.cardDao().insertCard(
        CardEntity(
            cardId = cardId,
            workspaceId = workspaceId,
            frontText = "Front",
            backText = "Back",
            effortLevel = EffortLevel.MEDIUM,
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 1L,
            reps = 0,
            lapses = 0,
            fsrsCardState = FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null,
            deletedAtMillis = null
        )
    )
}

private fun clearSyncLocalStoreSharedPreferences(context: Context): Unit {
    context.deleteSharedPreferences("flashcards-cloud-metadata")
    context.deleteSharedPreferences("flashcards-cloud-secrets")
    context.deleteSharedPreferences("flashcards-review-preferences")
}
