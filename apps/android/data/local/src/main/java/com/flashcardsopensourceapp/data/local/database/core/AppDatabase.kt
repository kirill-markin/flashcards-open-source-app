package com.flashcardsopensourceapp.data.local.database.core

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.flashcardsopensourceapp.data.local.database.cards.CardDao
import com.flashcardsopensourceapp.data.local.database.cards.DeckDao
import com.flashcardsopensourceapp.data.local.database.cards.TagDao
import com.flashcardsopensourceapp.data.local.database.cards.WorkspaceDao
import com.flashcardsopensourceapp.data.local.database.cards.WorkspaceSchedulerSettingsDao
import com.flashcardsopensourceapp.data.local.database.entities.AppLocalSettingsEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.DeckEntity
import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLeaderboardCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import com.flashcardsopensourceapp.data.local.database.migrations.createAppDatabaseMigrations
import com.flashcardsopensourceapp.data.local.database.progress.ProgressCardDao
import com.flashcardsopensourceapp.data.local.database.progress.ProgressLocalCacheDao
import com.flashcardsopensourceapp.data.local.database.progress.ProgressRemoteCacheDao
import com.flashcardsopensourceapp.data.local.database.review.ReviewCardSelectionDao
import com.flashcardsopensourceapp.data.local.database.review.ReviewCountDao
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import com.flashcardsopensourceapp.data.local.database.review.ReviewQueueDao
import com.flashcardsopensourceapp.data.local.database.sync.OutboxDao
import com.flashcardsopensourceapp.data.local.database.sync.SyncStateDao

private const val appDatabaseName: String = "flashcards-android.db"

@Database(
    entities = [
        AppLocalSettingsEntity::class,
        WorkspaceEntity::class,
        WorkspaceSchedulerSettingsEntity::class,
        DeckEntity::class,
        CardEntity::class,
        TagEntity::class,
        CardTagEntity::class,
        ReviewLogEntity::class,
        OutboxEntryEntity::class,
        SyncStateEntity::class,
        ProgressSummaryCacheEntity::class,
        ProgressSeriesCacheEntity::class,
        ProgressReviewScheduleCacheEntity::class,
        ProgressLeaderboardCacheEntity::class,
        ProgressLocalDayCountEntity::class,
        ProgressReviewHistoryStateEntity::class,
        ProgressLocalCacheStateEntity::class
    ],
    version = 20,
    exportSchema = false
)
@TypeConverters(DatabaseTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun appLocalSettingsDao(): AppLocalSettingsDao
    abstract fun workspaceDao(): WorkspaceDao
    abstract fun workspaceSchedulerSettingsDao(): WorkspaceSchedulerSettingsDao
    abstract fun deckDao(): DeckDao
    abstract fun cardDao(): CardDao
    abstract fun reviewQueueDao(): ReviewQueueDao
    abstract fun reviewCardSelectionDao(): ReviewCardSelectionDao
    abstract fun reviewCountDao(): ReviewCountDao
    abstract fun progressCardDao(): ProgressCardDao
    abstract fun tagDao(): TagDao
    abstract fun reviewLogDao(): ReviewLogDao
    abstract fun outboxDao(): OutboxDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun progressRemoteCacheDao(): ProgressRemoteCacheDao
    abstract fun progressLocalCacheDao(): ProgressLocalCacheDao
}

fun closeAppDatabase(database: AppDatabase) {
    database.close()
}

fun buildAppDatabase(context: Context): AppDatabase {
    return Room.databaseBuilder(
        context = context,
        klass = AppDatabase::class.java,
        name = appDatabaseName
    ).addMigrations(*createAppDatabaseMigrations()).build()
}
