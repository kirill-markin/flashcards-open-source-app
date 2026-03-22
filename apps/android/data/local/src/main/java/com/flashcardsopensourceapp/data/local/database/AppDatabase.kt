package com.flashcardsopensourceapp.data.local.database

import android.content.Context
import androidx.room.migration.Migration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        WorkspaceEntity::class,
        WorkspaceSchedulerSettingsEntity::class,
        DeckEntity::class,
        CardEntity::class,
        TagEntity::class,
        CardTagEntity::class,
        ReviewLogEntity::class,
        OutboxEntryEntity::class,
        SyncStateEntity::class
    ],
    version = 3,
    exportSchema = false
)
@TypeConverters(DatabaseTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun workspaceDao(): WorkspaceDao
    abstract fun workspaceSchedulerSettingsDao(): WorkspaceSchedulerSettingsDao
    abstract fun deckDao(): DeckDao
    abstract fun cardDao(): CardDao
    abstract fun tagDao(): TagDao
    abstract fun reviewLogDao(): ReviewLogDao
    abstract fun outboxDao(): OutboxDao
    abstract fun syncStateDao(): SyncStateDao
}

fun buildAppDatabase(context: Context): AppDatabase {
    return Room.databaseBuilder(
        context = context,
        klass = AppDatabase::class.java,
        name = "flashcards-android-draft.db"
    ).addMigrations(migration2To3).build()
}

val migration2To3: Migration = object : Migration(2, 3) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE cards ADD COLUMN dueAtMillis INTEGER")
        database.execSQL("ALTER TABLE cards ADD COLUMN reps INTEGER NOT NULL DEFAULT 0")
        database.execSQL("ALTER TABLE cards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsCardState TEXT NOT NULL DEFAULT 'NEW'")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsStepIndex INTEGER")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsStability REAL")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsDifficulty REAL")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsLastReviewedAtMillis INTEGER")
        database.execSQL("ALTER TABLE cards ADD COLUMN fsrsScheduledDays INTEGER")
        database.execSQL(
            """
            CREATE TABLE IF NOT EXISTS workspace_scheduler_settings (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                algorithm TEXT NOT NULL,
                desiredRetention REAL NOT NULL,
                learningStepsMinutesJson TEXT NOT NULL,
                relearningStepsMinutesJson TEXT NOT NULL,
                maximumIntervalDays INTEGER NOT NULL,
                enableFuzz INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        database.execSQL(
            """
            INSERT INTO workspace_scheduler_settings (
                workspaceId,
                algorithm,
                desiredRetention,
                learningStepsMinutesJson,
                relearningStepsMinutesJson,
                maximumIntervalDays,
                enableFuzz,
                updatedAtMillis
            )
            SELECT
                workspaceId,
                'fsrs-6',
                0.9,
                '[1,10]',
                '[10]',
                36500,
                1,
                createdAtMillis
            FROM workspaces
            """.trimIndent()
        )
        database.execSQL(
            "CREATE INDEX IF NOT EXISTS index_workspace_scheduler_settings_workspaceId ON workspace_scheduler_settings(workspaceId)"
        )
    }
}
