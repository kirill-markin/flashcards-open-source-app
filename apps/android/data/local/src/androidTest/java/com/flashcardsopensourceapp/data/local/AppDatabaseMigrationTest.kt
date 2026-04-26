package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migration10To11
import com.flashcardsopensourceapp.data.local.database.migration12To13
import com.flashcardsopensourceapp.data.local.database.migration5To6
import com.flashcardsopensourceapp.data.local.database.migration9To10
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    private val targetedMigrationDatabaseName: String = "migration-test.db"
    private val migration10DatabaseName: String = "migration-10-test.db"

    @After
    fun tearDown() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(targetedMigrationDatabaseName)
        context.deleteDatabase(migration10DatabaseName)
    }

    // These are intentionally single-migration regression tests; keep their scope narrow.
    @Test
    fun migrationFromVersion5AddsAppLocalSettingsWithoutDestroyingCards() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion5Database(context = context)

        val openHelper = openDatabaseAtVersion(
            context = context,
            name = targetedMigrationDatabaseName,
            version = 5
        )
        val database = openHelper.writableDatabase

        try {
            migration5To6.migrate(database)

            assertTrue(tableExists(database = database, tableName = "app_local_settings"))
            assertEquals(
                0L,
                readSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM app_local_settings"
                )
            )
            assertEquals(
                1L,
                readSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                0L,
                readSingleLong(
                    database = database,
                    sql = "SELECT reps FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                0L,
                readSingleLong(
                    database = database,
                    sql = "SELECT lapses FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                "NEW",
                readSingleString(
                    database = database,
                    sql = "SELECT fsrsCardState FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(
                "fsrs-6",
                readSingleString(
                    database = database,
                    sql = """
                        SELECT algorithm
                        FROM workspace_scheduler_settings
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
            assertEquals(
                "[1,10]",
                readSingleString(
                    database = database,
                    sql = """
                        SELECT learningStepsMinutesJson
                        FROM workspace_scheduler_settings
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migrationFromVersion9SplitsProgressSnapshotCacheIntoSummaryAndSeriesTables() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion9Database(context = context)

        val openHelper = openDatabaseAtVersion(
            context = context,
            name = targetedMigrationDatabaseName,
            version = 9
        )
        val database = openHelper.writableDatabase

        try {
            migration9To10.migrate(database)

            assertTrue(tableExists(database = database, tableName = "progress_summary_cache"))
            assertTrue(tableExists(database = database, tableName = "progress_series_cache"))
            assertFalse(tableExists(database = database, tableName = "progress_snapshot_cache"))
            assertEquals(
                0L,
                readSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_summary_cache"
                )
            )
            assertEquals(
                1L,
                readSingleLong(
                    database = database,
                    sql = "SELECT COUNT(*) FROM progress_series_cache"
                )
            )
            assertEquals(
                "scope-1",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "scopeKey",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "local:installation-1",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "scopeId",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "Europe/Madrid",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "timeZone",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-17",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "fromLocalDate",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-18",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "toLocalDate",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "2026-04-18T12:00:00Z",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "generatedAt",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                "[{\"date\":\"2026-04-17\",\"reviewCount\":3},{\"date\":\"2026-04-18\",\"reviewCount\":1}]",
                readSingleStringByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "dailyReviewsJson",
                    scopeKey = "scope-1"
                )
            )
            assertEquals(
                123L,
                readSingleLongByScopeKey(
                    database = database,
                    tableName = "progress_series_cache",
                    columnName = "updatedAtMillis",
                    scopeKey = "scope-1"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration10To11AddsReviewedAtIndexToReviewLogs() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion10Database(context = context)

        val openHelper = openDatabaseAtVersion(
            context = context,
            name = migration10DatabaseName,
            version = 10
        )
        val database = openHelper.writableDatabase

        try {
            migration10To11.migrate(database)
            assertReviewLogsReviewedAtIndexExists(database = database)
        } finally {
            database.close()
            openHelper.close()
        }
    }

    @Test
    fun migration12To13AddsPendingReviewHistoryImportMarkerDefaultFalse() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        createVersion12Database(context = context)

        val openHelper = openDatabaseAtVersion(
            context = context,
            name = targetedMigrationDatabaseName,
            version = 12
        )
        val database = openHelper.writableDatabase

        try {
            migration12To13.migrate(database)

            assertEquals(
                0L,
                readSingleLong(
                    database = database,
                    sql = """
                        SELECT pendingReviewHistoryImport
                        FROM sync_state
                        WHERE workspaceId = 'workspace-local'
                    """.trimIndent()
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion5Database(context: Context) {
        val databaseFile = context.getDatabasePath(targetedMigrationDatabaseName)
        if (databaseFile.exists()) {
            databaseFile.delete()
        }
        databaseFile.parentFile?.mkdirs()

        val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqliteDatabase.execSQL(
            "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE decks (
                deckId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                name TEXT NOT NULL,
                filterDefinitionJson TEXT NOT NULL,
                createdAtMillis INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                deletedAtMillis INTEGER,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE cards (
                cardId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                frontText TEXT NOT NULL,
                backText TEXT NOT NULL,
                effortLevel TEXT NOT NULL,
                dueAtMillis INTEGER,
                createdAtMillis INTEGER NOT NULL,
                updatedAtMillis INTEGER NOT NULL,
                reps INTEGER NOT NULL,
                lapses INTEGER NOT NULL,
                fsrsCardState TEXT NOT NULL,
                fsrsStepIndex INTEGER,
                fsrsStability REAL,
                fsrsDifficulty REAL,
                fsrsLastReviewedAtMillis INTEGER,
                fsrsScheduledDays INTEGER,
                deletedAtMillis INTEGER,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE tags (
                tagId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                name TEXT NOT NULL,
                FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE card_tags (
                cardId TEXT NOT NULL,
                tagId TEXT NOT NULL,
                PRIMARY KEY(cardId, tagId),
                FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE,
                FOREIGN KEY(tagId) REFERENCES tags(tagId) ON DELETE CASCADE
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE review_logs (
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
        sqliteDatabase.execSQL(
            """
            CREATE TABLE outbox_entries (
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
        sqliteDatabase.execSQL(
            """
            CREATE TABLE sync_state (
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
        sqliteDatabase.execSQL(
            """
            CREATE TABLE workspace_scheduler_settings (
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
        sqliteDatabase.execSQL("CREATE INDEX index_decks_workspaceId ON decks(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_cards_workspaceId ON cards(workspaceId)")
        sqliteDatabase.execSQL("CREATE UNIQUE INDEX index_tags_workspaceId_name ON tags(workspaceId, name)")
        sqliteDatabase.execSQL("CREATE INDEX index_card_tags_tagId ON card_tags(tagId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_workspaceId ON review_logs(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_review_logs_cardId ON review_logs(cardId)")
        sqliteDatabase.execSQL("CREATE INDEX index_outbox_entries_workspaceId ON outbox_entries(workspaceId)")
        sqliteDatabase.execSQL("CREATE INDEX index_workspace_scheduler_settings_workspaceId ON workspace_scheduler_settings(workspaceId)")

        sqliteDatabase.execSQL(
            "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
        )
        sqliteDatabase.execSQL(
            """
            INSERT INTO cards (
                cardId,
                workspaceId,
                frontText,
                backText,
                effortLevel,
                dueAtMillis,
                createdAtMillis,
                updatedAtMillis,
                reps,
                lapses,
                fsrsCardState,
                fsrsStepIndex,
                fsrsStability,
                fsrsDifficulty,
                fsrsLastReviewedAtMillis,
                fsrsScheduledDays,
                deletedAtMillis
            ) VALUES (
                'card-1',
                'workspace-local',
                'Front',
                'Back',
                'FAST',
                NULL,
                100,
                100,
                0,
                0,
                'NEW',
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
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
            ) VALUES (
                'workspace-local',
                'fsrs-6',
                0.9,
                '[1,10]',
                '[10]',
                36500,
                1,
                100
            )
            """.trimIndent()
        )

        sqliteDatabase.version = 5
        sqliteDatabase.close()
    }

    private fun createVersion9Database(context: Context) {
        val databaseFile = context.getDatabasePath(targetedMigrationDatabaseName)
        if (databaseFile.exists()) {
            databaseFile.delete()
        }
        databaseFile.parentFile?.mkdirs()

        val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqliteDatabase.execSQL(
            "CREATE TABLE workspaces (workspaceId TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, createdAtMillis INTEGER NOT NULL)"
        )
        sqliteDatabase.execSQL(
            """
            CREATE TABLE progress_snapshot_cache (
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
        sqliteDatabase.execSQL(
            "INSERT INTO workspaces (workspaceId, name, createdAtMillis) VALUES ('workspace-local', 'Personal', 100)"
        )
        sqliteDatabase.execSQL(
            """
            INSERT INTO progress_snapshot_cache (
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
            ) VALUES (
                'scope-1',
                'local:installation-1',
                'Europe/Madrid',
                '2026-04-17',
                '2026-04-18',
                '2026-04-18T12:00:00Z',
                4,
                1,
                '2026-04-18',
                12,
                '[{"date":"2026-04-17","reviewCount":3},{"date":"2026-04-18","reviewCount":1}]',
                123
            )
            """.trimIndent()
        )

        sqliteDatabase.version = 9
        sqliteDatabase.close()
    }

    private fun createVersion10Database(context: Context) {
        val databaseFile = context.getDatabasePath(migration10DatabaseName)
        if (databaseFile.exists()) {
            databaseFile.delete()
        }
        databaseFile.parentFile?.mkdirs()

        val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqliteDatabase.execSQL(
            """
            CREATE TABLE review_logs (
                reviewLogId TEXT NOT NULL PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                cardId TEXT NOT NULL,
                replicaId TEXT NOT NULL,
                clientEventId TEXT NOT NULL,
                rating TEXT NOT NULL,
                reviewedAtMillis INTEGER NOT NULL,
                reviewedAtServerIso TEXT NOT NULL
            )
            """.trimIndent()
        )
        sqliteDatabase.version = 10
        sqliteDatabase.close()
    }

    private fun createVersion12Database(context: Context) {
        val databaseFile = context.getDatabasePath(targetedMigrationDatabaseName)
        if (databaseFile.exists()) {
            databaseFile.delete()
        }
        databaseFile.parentFile?.mkdirs()

        val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqliteDatabase.execSQL(
            """
            CREATE TABLE sync_state (
                workspaceId TEXT NOT NULL PRIMARY KEY,
                lastSyncCursor TEXT,
                lastReviewSequenceId INTEGER NOT NULL,
                hasHydratedHotState INTEGER NOT NULL,
                hasHydratedReviewHistory INTEGER NOT NULL,
                lastSyncAttemptAtMillis INTEGER,
                lastSuccessfulSyncAtMillis INTEGER,
                lastSyncError TEXT,
                blockedInstallationId TEXT
            )
            """.trimIndent()
        )
        sqliteDatabase.execSQL(
            """
            INSERT INTO sync_state (
                workspaceId,
                lastSyncCursor,
                lastReviewSequenceId,
                hasHydratedHotState,
                hasHydratedReviewHistory,
                lastSyncAttemptAtMillis,
                lastSuccessfulSyncAtMillis,
                lastSyncError,
                blockedInstallationId
            ) VALUES (
                'workspace-local',
                '123',
                456,
                1,
                0,
                1000,
                NULL,
                NULL,
                NULL
            )
            """.trimIndent()
        )
        sqliteDatabase.version = 12
        sqliteDatabase.close()
    }

    private fun openDatabaseAtVersion(
        context: Context,
        name: String,
        version: Int
    ): SupportSQLiteOpenHelper {
        val callback = object : SupportSQLiteOpenHelper.Callback(version) {
            override fun onCreate(db: SupportSQLiteDatabase) = Unit

            override fun onUpgrade(
                db: SupportSQLiteDatabase,
                oldVersion: Int,
                newVersion: Int
            ) = Unit
        }
        val configuration = SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(name)
            .callback(callback)
            .build()

        return FrameworkSQLiteOpenHelperFactory().create(configuration)
    }

    private fun tableExists(
        database: SupportSQLiteDatabase,
        tableName: String
    ): Boolean {
        return database.query(
            SimpleSQLiteQuery(
                """
                SELECT COUNT(*)
                FROM sqlite_master
                WHERE type = 'table' AND name = ?
                """.trimIndent(),
                arrayOf(tableName)
            )
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0) > 0
        }
    }

    private fun readSingleString(
        database: SupportSQLiteDatabase,
        sql: String
    ): String {
        return database.query(SimpleSQLiteQuery(sql)).use { cursor ->
            cursor.moveToFirst()
            cursor.getString(0)
        }
    }

    private fun readSingleLong(
        database: SupportSQLiteDatabase,
        sql: String
    ): Long {
        return database.query(SimpleSQLiteQuery(sql)).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0)
        }
    }

    private fun readSingleStringByScopeKey(
        database: SupportSQLiteDatabase,
        tableName: String,
        columnName: String,
        scopeKey: String
    ): String {
        return database.query(
            SimpleSQLiteQuery(
                "SELECT $columnName FROM $tableName WHERE scopeKey = ?",
                arrayOf(scopeKey)
            )
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getString(0)
        }
    }

    private fun readSingleLongByScopeKey(
        database: SupportSQLiteDatabase,
        tableName: String,
        columnName: String,
        scopeKey: String
    ): Long {
        return database.query(
            SimpleSQLiteQuery(
                "SELECT $columnName FROM $tableName WHERE scopeKey = ?",
                arrayOf(scopeKey)
            )
        ).use { cursor ->
            cursor.moveToFirst()
            cursor.getLong(0)
        }
    }

    private fun assertReviewLogsReviewedAtIndexExists(database: SupportSQLiteDatabase) {
        val query = SimpleSQLiteQuery("PRAGMA index_list('review_logs')")
        val hasReviewedAtIndex = database.query(query).use { cursor ->
            val nameColumnIndex = cursor.getColumnIndexOrThrow("name")

            while (cursor.moveToNext()) {
                if (cursor.getString(nameColumnIndex) == "index_review_logs_reviewedAtMillis") {
                    return@use true
                }
            }

            false
        }

        assertTrue(hasReviewedAtIndex)
    }
}
