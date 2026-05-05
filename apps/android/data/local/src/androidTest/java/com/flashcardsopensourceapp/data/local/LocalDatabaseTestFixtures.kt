package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.progress.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class LocalDatabaseTestRuntime(
    val context: Context,
    val database: AppDatabase,
    val preferencesStore: CloudPreferencesStore,
    val syncLocalStore: SyncLocalStore,
    val syncRepository: SyncRepository
)

internal suspend fun createLocalDatabaseTestRuntime(): LocalDatabaseTestRuntime {
    val context = ApplicationProvider.getApplicationContext<Context>()
    clearLocalDatabaseSharedPreferences(context = context)
    val database = createInMemoryAppDatabase(context = context)
    val preferencesStore = CloudPreferencesStore(context = context, database = database)
    preferencesStore.hydrateCloudSettingsFromDatabase()
    val syncLocalStore = SyncLocalStore(
        database = database,
        preferencesStore = preferencesStore,
        reviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context),
        localProgressCacheStore = LocalProgressCacheStore(
            database = database,
            timeProvider = SystemTimeProvider
        ),
        timeProvider = SystemTimeProvider
    )
    return LocalDatabaseTestRuntime(
        context = context,
        database = database,
        preferencesStore = preferencesStore,
        syncLocalStore = syncLocalStore,
        syncRepository = FakeSyncRepository()
    )
}

internal fun closeLocalDatabaseTestRuntime(runtime: LocalDatabaseTestRuntime): Unit {
    runtime.database.close()
    clearLocalDatabaseSharedPreferences(context = runtime.context)
}

internal fun clearLocalDatabaseSharedPreferences(context: Context): Unit {
    context.deleteSharedPreferences("flashcards-cloud-metadata")
    context.deleteSharedPreferences("flashcards-cloud-secrets")
    context.deleteSharedPreferences("flashcards-review-preferences")
}

internal fun createInMemoryAppDatabase(context: Context): AppDatabase {
    return Room.inMemoryDatabaseBuilder(
        context = context,
        klass = AppDatabase::class.java
    ).allowMainThreadQueries().build()
}

internal suspend fun bootstrapTestWorkspace(
    runtime: LocalDatabaseTestRuntime,
    currentTimeMillis: Long
): String {
    val workspaceId = ensureLocalWorkspaceShell(
        database = runtime.database,
        currentTimeMillis = currentTimeMillis
    )
    runtime.preferencesStore.hydrateCloudSettingsFromDatabase()
    return workspaceId
}

internal fun createTestCardsRepository(runtime: LocalDatabaseTestRuntime): CardsRepository {
    return LocalCardsRepository(
        database = runtime.database,
        preferencesStore = runtime.preferencesStore,
        syncLocalStore = runtime.syncLocalStore
    )
}

internal fun createTestDecksRepository(runtime: LocalDatabaseTestRuntime): DecksRepository {
    return LocalDecksRepository(
        database = runtime.database,
        preferencesStore = runtime.preferencesStore,
        syncLocalStore = runtime.syncLocalStore
    )
}

internal fun createTestWorkspaceRepository(runtime: LocalDatabaseTestRuntime): WorkspaceRepository {
    return LocalWorkspaceRepository(
        database = runtime.database,
        preferencesStore = runtime.preferencesStore,
        syncRepository = runtime.syncRepository,
        syncLocalStore = runtime.syncLocalStore
    )
}

internal fun createTestReviewRepository(runtime: LocalDatabaseTestRuntime): ReviewRepository {
    return LocalReviewRepository(
        database = runtime.database,
        preferencesStore = runtime.preferencesStore,
        syncLocalStore = runtime.syncLocalStore,
        localProgressCacheStore = LocalProgressCacheStore(
            database = runtime.database,
            timeProvider = SystemTimeProvider
        )
    )
}

internal fun makeDueReviewOrderingCardEntity(
    cardId: String,
    workspaceId: String,
    effortLevel: EffortLevel,
    dueAtMillis: Long,
    createdAtMillis: Long,
    updatedAtMillis: Long
): CardEntity {
    return CardEntity(
        cardId = cardId,
        workspaceId = workspaceId,
        frontText = cardId,
        backText = "Back",
        effortLevel = effortLevel,
        dueAtMillis = dueAtMillis,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = updatedAtMillis,
        reps = 1,
        lapses = 0,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = 1.0,
        fsrsDifficulty = 1.0,
        fsrsLastReviewedAtMillis = createdAtMillis,
        fsrsScheduledDays = 1,
        deletedAtMillis = null
    )
}

internal fun makeNewReviewOrderingCardEntity(
    cardId: String,
    workspaceId: String,
    effortLevel: EffortLevel,
    createdAtMillis: Long,
    updatedAtMillis: Long
): CardEntity {
    return CardEntity(
        cardId = cardId,
        workspaceId = workspaceId,
        frontText = cardId,
        backText = "Back",
        effortLevel = effortLevel,
        dueAtMillis = null,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = updatedAtMillis,
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
}

private class FakeSyncRepository : SyncRepository {
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus.asStateFlow()
    }

    override suspend fun scheduleSync() {
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Syncing)
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Idle)
    }

    override suspend fun syncNow() {
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Syncing)
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Idle)
    }
}
