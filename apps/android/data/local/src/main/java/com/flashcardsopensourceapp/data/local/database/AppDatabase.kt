package com.flashcardsopensourceapp.data.local.database

import android.content.Context
import androidx.room.migration.Migration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase

private const val appDatabaseName: String = "flashcards-android.db"
private const val androidInstallationId: String = "android-installation"

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
        ProgressLocalDayCountEntity::class,
        ProgressReviewHistoryStateEntity::class,
        ProgressLocalCacheStateEntity::class
    ],
    version = 11,
    exportSchema = false
)
@TypeConverters(DatabaseTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun appLocalSettingsDao(): AppLocalSettingsDao
    abstract fun workspaceDao(): WorkspaceDao
    abstract fun workspaceSchedulerSettingsDao(): WorkspaceSchedulerSettingsDao
    abstract fun deckDao(): DeckDao
    abstract fun cardDao(): CardDao
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
    ).addMigrations(
        migration2To3,
        migration3To4,
        migration4To5,
        migration5To6,
        migration6To7,
        migration7To8,
        migration8To9,
        migration9To10,
        migration10To11
    ).build()
}

val migration2To3: Migration = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE cards ADD COLUMN dueAtMillis INTEGER")
        db.execSQL("ALTER TABLE cards ADD COLUMN reps INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE cards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsCardState TEXT NOT NULL DEFAULT 'NEW'")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsStepIndex INTEGER")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsStability REAL")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsDifficulty REAL")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsLastReviewedAtMillis INTEGER")
        db.execSQL("ALTER TABLE cards ADD COLUMN fsrsScheduledDays INTEGER")
        db.execSQL(
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
        db.execSQL(
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
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS index_workspace_scheduler_settings_workspaceId ON workspace_scheduler_settings(workspaceId)"
        )
    }
}

val migration3To4: Migration = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE cards ADD COLUMN deletedAtMillis INTEGER")
        db.execSQL("ALTER TABLE decks ADD COLUMN deletedAtMillis INTEGER")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS review_logs_v4 (
                reviewLogId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                cardId TEXT NOT NULL,
                replicaId TEXT NOT NULL,
                clientEventId TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewedAtMillis INTEGER NOT NULL,
                reviewedAtServerIso TEXT NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE,
                FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO review_logs_v4 (
                reviewLogId,
                workspaceId,
                cardId,
                replicaId,
                clientEventId,
                rating,
                reviewedAtMillis,
                reviewedAtServerIso
            )
            SELECT
                reviewLogId,
                workspaceId,
                cardId,
                '$androidInstallationId',
                reviewLogId,
                rating,
                reviewedAtMillis,
                '1970-01-01T00:00:00Z'
            FROM review_logs
            """.trimIndent()
        )
        db.execSQL("DROP TABLE review_logs")
        db.execSQL("ALTER TABLE review_logs_v4 RENAME TO review_logs")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_workspaceId ON review_logs(workspaceId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_cardId ON review_logs(cardId)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS outbox_entries_v4 (
                outboxEntryId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                installationId TEXT NOT NULL,
                entityType TEXT NOT NULL,
                entityId TEXT NOT NULL,
                operationType TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                clientUpdatedAtIso TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                attemptCount INTEGER NOT NULL,
                lastError TEXT,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO outbox_entries_v4 (
                outboxEntryId,
                workspaceId,
                installationId,
                entityType,
                entityId,
                operationType,
                payloadJson,
                clientUpdatedAtIso,
                createdAtMillis,
                attemptCount,
                lastError
            )
            SELECT
                outboxEntryId,
                workspaceId,
                '$androidInstallationId',
                'workspace_scheduler_settings',
                workspaceId,
                operationType,
                payloadJson,
                '1970-01-01T00:00:00Z',
                createdAtMillis,
                0,
                NULL
            FROM outbox_entries
            """.trimIndent()
        )
        db.execSQL("DROP TABLE outbox_entries")
        db.execSQL("ALTER TABLE outbox_entries_v4 RENAME TO outbox_entries")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_outbox_entries_workspaceId ON outbox_entries(workspaceId)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS sync_state_v4 (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                lastSyncCursor TEXT,
                lastReviewSequenceId INTEGER NOT NULL,
                hasHydratedHotState INTEGER NOT NULL,
                hasHydratedReviewHistory INTEGER NOT NULL,
                lastSyncAttemptAtMillis INTEGER,
                lastSuccessfulSyncAtMillis INTEGER,
                lastSyncError TEXT
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO sync_state_v4 (
                workspaceId,
                lastSyncCursor,
                lastReviewSequenceId,
                hasHydratedHotState,
                hasHydratedReviewHistory,
                lastSyncAttemptAtMillis,
                lastSuccessfulSyncAtMillis,
                lastSyncError
            )
            SELECT
                workspaceId,
                lastSyncCursor,
                0,
                CASE WHEN lastSyncCursor IS NULL THEN 0 ELSE 1 END,
                0,
                lastSyncAttemptAtMillis,
                NULL,
                NULL
            FROM sync_state
            """.trimIndent()
        )
        db.execSQL("DROP TABLE sync_state")
        db.execSQL("ALTER TABLE sync_state_v4 RENAME TO sync_state")
    }
}

val migration4To5: Migration = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS review_logs_v5 (
                reviewLogId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                cardId TEXT NOT NULL,
                replicaId TEXT NOT NULL,
                clientEventId TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewedAtMillis INTEGER NOT NULL,
                reviewedAtServerIso TEXT NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE,
                FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO review_logs_v5 (
                reviewLogId,
                workspaceId,
                cardId,
                replicaId,
                clientEventId,
                rating,
                reviewedAtMillis,
                reviewedAtServerIso
            )
            SELECT
                reviewLogId,
                workspaceId,
                cardId,
                replicaId,
                clientEventId,
                rating,
                reviewedAtMillis,
                reviewedAtServerIso
            FROM review_logs
            """.trimIndent()
        )
        db.execSQL("DROP TABLE review_logs")
        db.execSQL("ALTER TABLE review_logs_v5 RENAME TO review_logs")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_workspaceId ON review_logs(workspaceId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_cardId ON review_logs(cardId)")

        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS outbox_entries_v5 (
                outboxEntryId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                installationId TEXT NOT NULL,
                entityType TEXT NOT NULL,
                entityId TEXT NOT NULL,
                operationType TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                clientUpdatedAtIso TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                attemptCount INTEGER NOT NULL,
                lastError TEXT,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO outbox_entries_v5 (
                outboxEntryId,
                workspaceId,
                installationId,
                entityType,
                entityId,
                operationType,
                payloadJson,
                clientUpdatedAtIso,
                createdAtMillis,
                attemptCount,
                lastError
            )
            SELECT
                outboxEntryId,
                workspaceId,
                installationId,
                entityType,
                entityId,
                operationType,
                payloadJson,
                clientUpdatedAtIso,
                createdAtMillis,
                attemptCount,
                lastError
            FROM outbox_entries
            """.trimIndent()
        )
        db.execSQL("DROP TABLE outbox_entries")
        db.execSQL("ALTER TABLE outbox_entries_v5 RENAME TO outbox_entries")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_outbox_entries_workspaceId ON outbox_entries(workspaceId)")
    }
}

val migration5To6: Migration = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS app_local_settings (
                settingsId INTEGER NOT NULL PRIMARY KEY,
                installationId TEXT NOT NULL,
                cloudState TEXT NOT NULL,
                linkedUserId TEXT,
                linkedWorkspaceId TEXT,
                linkedEmail TEXT,
                activeWorkspaceId TEXT,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }
}

val migration6To7: Migration = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_snapshot_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                timeZone TEXT NOT NULL,
                fromLocalDate TEXT NOT NULL,
                toLocalDate TEXT NOT NULL,
                generatedAt TEXT,
                summaryCurrentStreakDays INTEGER,
                summaryHasReviewedToday INTEGER,
                summaryLastReviewedOn TEXT,
                summaryActiveReviewDays INTEGER,
                dailyReviewsJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }
}

val migration7To8: Migration = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_snapshot_cache_v8 (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                timeZone TEXT NOT NULL,
                fromLocalDate TEXT NOT NULL,
                toLocalDate TEXT NOT NULL,
                generatedAt TEXT,
                summaryCurrentStreakDays INTEGER,
                summaryHasReviewedToday INTEGER,
                summaryLastReviewedOn TEXT,
                summaryActiveReviewDays INTEGER,
                dailyReviewsJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO progress_snapshot_cache_v8 (
                scopeKey,
                scopeId,
                timeZone,
                fromLocalDate,
                toLocalDate,
                generatedAt,
                summaryCurrentStreakDays,
                summaryHasReviewedToday,
                summaryLastReviewedOn,
                summaryActiveReviewDays,
                dailyReviewsJson,
                updatedAtMillis
            )
            SELECT
                scopeKey,
                scopeId,
                timeZone,
                fromLocalDate,
                toLocalDate,
                generatedAt,
                NULL,
                NULL,
                NULL,
                NULL,
                dailyReviewsJson,
                updatedAtMillis
            FROM progress_snapshot_cache
            """.trimIndent()
        )
        db.execSQL("DROP TABLE progress_snapshot_cache")
        db.execSQL("ALTER TABLE progress_snapshot_cache_v8 RENAME TO progress_snapshot_cache")
    }
}

val migration8To9: Migration = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        val escapedTimeZone = java.time.ZoneId.systemDefault().id.replace("'", "''")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_local_day_counts (
                timeZone TEXT NOT NULL,
                workspaceId TEXT NOT NULL,
                localDate TEXT NOT NULL,
                reviewCount INTEGER NOT NULL,
                PRIMARY KEY(timeZone, workspaceId, localDate),
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS index_progress_local_day_counts_workspaceId
            ON progress_local_day_counts(workspaceId)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS index_progress_local_day_counts_timeZone
            ON progress_local_day_counts(timeZone)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_review_history_state (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                historyVersion INTEGER NOT NULL,
                reviewLogCount INTEGER NOT NULL,
                maxReviewedAtMillis INTEGER NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS index_progress_review_history_state_workspaceId
            ON progress_review_history_state(workspaceId)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_local_cache_state (
                timeZone TEXT NOT NULL,
                workspaceId TEXT NOT NULL,
                historyVersion INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                PRIMARY KEY(timeZone, workspaceId),
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS index_progress_local_cache_state_workspaceId
            ON progress_local_cache_state(workspaceId)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS index_progress_local_cache_state_timeZone
            ON progress_local_cache_state(timeZone)
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO progress_review_history_state (
                workspaceId,
                historyVersion,
                reviewLogCount,
                maxReviewedAtMillis
            )
            SELECT
                workspaceId,
                COUNT(*) AS historyVersion,
                COUNT(*) AS reviewLogCount,
                MAX(reviewedAtMillis) AS maxReviewedAtMillis
            FROM review_logs
            GROUP BY workspaceId
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO progress_local_day_counts (
                timeZone,
                workspaceId,
                localDate,
                reviewCount
            )
            SELECT
                '$escapedTimeZone',
                workspaceId,
                date(reviewedAtMillis / 1000, 'unixepoch', 'localtime'),
                COUNT(*)
            FROM review_logs
            GROUP BY workspaceId, date(reviewedAtMillis / 1000, 'unixepoch', 'localtime')
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO progress_local_cache_state (
                timeZone,
                workspaceId,
                historyVersion,
                updatedAtMillis
            )
            SELECT
                '$escapedTimeZone',
                workspaceId,
                historyVersion,
                maxReviewedAtMillis
            FROM progress_review_history_state
            """.trimIndent()
        )
    }
}

val migration9To10: Migration = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_summary_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                timeZone TEXT NOT NULL,
                generatedAt TEXT,
                currentStreakDays INTEGER NOT NULL,
                hasReviewedToday INTEGER NOT NULL,
                lastReviewedOn TEXT,
                activeReviewDays INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_series_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                timeZone TEXT NOT NULL,
                fromLocalDate TEXT NOT NULL,
                toLocalDate TEXT NOT NULL,
                generatedAt TEXT,
                dailyReviewsJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            INSERT INTO progress_series_cache (
                scopeKey,
                scopeId,
                timeZone,
                fromLocalDate,
                toLocalDate,
                generatedAt,
                dailyReviewsJson,
                updatedAtMillis
            )
            SELECT
                scopeKey,
                scopeId,
                timeZone,
                fromLocalDate,
                toLocalDate,
                generatedAt,
                dailyReviewsJson,
                updatedAtMillis
            FROM progress_snapshot_cache
            """.trimIndent()
        )
        db.execSQL("DROP TABLE progress_snapshot_cache")
    }
}

val migration10To11: Migration = object : Migration(10, 11) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS index_review_logs_reviewedAtMillis ON review_logs(reviewedAtMillis)"
        )
    }
}
