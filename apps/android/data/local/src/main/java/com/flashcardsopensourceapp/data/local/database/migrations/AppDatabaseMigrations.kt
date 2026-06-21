package com.flashcardsopensourceapp.data.local.database.migrations

import androidx.room.migration.Migration
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteDatabase
import com.flashcardsopensourceapp.data.local.database.entities.cardsRecentlyReviewedDueIndexName
import com.flashcardsopensourceapp.data.local.database.entities.cardsReviewQueueIndexName
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private const val androidInstallationId: String = "android-installation"
private const val legacyMediumEffortTag: String = "medium"
private const val legacyLongEffortTag: String = "long"

fun createAppDatabaseMigrations(): Array<Migration> {
    return arrayOf(
        migration2To3,
        migration3To4,
        migration4To5,
        migration5To6,
        migration6To7,
        migration7To8,
        migration8To9,
        migration9To10,
        migration10To11,
        migration11To12,
        migration12To13,
        migration13To14,
        migration14To15,
        migration15To16,
        migration16To17,
        migration17To18,
        migration18To19,
        migration19To20,
        migration20To21,
        migration21To22,
        migration22To23,
        migration23To24,
        migration24To25
    )
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

val migration11To12: Migration = object : Migration(11, 12) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE sync_state ADD COLUMN blockedInstallationId TEXT")
    }
}

val migration12To13: Migration = object : Migration(12, 13) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE sync_state ADD COLUMN pendingReviewHistoryImport INTEGER NOT NULL DEFAULT 0")
    }
}

val migration13To14: Migration = object : Migration(13, 14) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS $cardsReviewQueueIndexName
            ON cards(workspaceId, dueAtMillis, createdAtMillis, cardId)
            """.trimIndent()
        )
    }
}

val migration14To15: Migration = object : Migration(14, 15) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_review_schedule_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                timeZone TEXT NOT NULL,
                referenceLocalDate TEXT NOT NULL,
                generatedAt TEXT,
                totalCards INTEGER NOT NULL,
                bucketsJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }
}

val migration15To16: Migration = object : Migration(15, 16) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "ALTER TABLE outbox_entries ADD COLUMN affectsReviewSchedule INTEGER NOT NULL DEFAULT 0"
        )
        db.execSQL(
            """
            -- Conservative backfill: legacy card/upsert outbox rows pre-date the
            -- affectsReviewSchedule column, so mark them as schedule-affecting to
            -- avoid skipping FSRS/queue invalidations on first sync after upgrade.
            UPDATE outbox_entries
            SET affectsReviewSchedule = 1
            WHERE entityType = 'card' AND operationType = 'upsert'
            """.trimIndent()
        )
    }
}

val migration16To17: Migration = object : Migration(16, 17) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS $cardsRecentlyReviewedDueIndexName
            ON cards(workspaceId, fsrsLastReviewedAtMillis, dueAtMillis, createdAtMillis, cardId)
            """.trimIndent()
        )
    }
}

val migration17To18: Migration = object : Migration(17, 18) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN reviewHistoryWatermarksJson TEXT NOT NULL DEFAULT '[]'
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_series_cache
            ADD COLUMN reviewHistoryWatermarksJson TEXT NOT NULL DEFAULT '[]'
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_review_schedule_cache
            ADD COLUMN reviewHistoryWatermarksJson TEXT NOT NULL DEFAULT '[]'
            """.trimIndent()
        )
    }
}

val migration18To19: Migration = object : Migration(18, 19) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_leaderboard_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }
}

val migration19To20: Migration = object : Migration(19, 20) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "ALTER TABLE progress_local_day_counts ADD COLUMN againCount INTEGER NOT NULL DEFAULT 0"
        )
        db.execSQL(
            "ALTER TABLE progress_local_day_counts ADD COLUMN hardCount INTEGER NOT NULL DEFAULT 0"
        )
        db.execSQL(
            "ALTER TABLE progress_local_day_counts ADD COLUMN goodCount INTEGER NOT NULL DEFAULT 0"
        )
        db.execSQL(
            "ALTER TABLE progress_local_day_counts ADD COLUMN easyCount INTEGER NOT NULL DEFAULT 0"
        )
        db.execSQL("DELETE FROM progress_local_cache_state")
    }
}

val migration20To21: Migration = object : Migration(20, 21) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DELETE FROM progress_summary_cache")
        db.execSQL("DELETE FROM progress_series_cache")
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN longestStreakDays INTEGER NOT NULL DEFAULT 0
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeAvailableCredits INTEGER NOT NULL DEFAULT 0
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeCapacity INTEGER NOT NULL DEFAULT 0
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeBalanceUnits INTEGER NOT NULL DEFAULT 0
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeUnitsPerCredit INTEGER NOT NULL DEFAULT 1
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeNextCreditProgressUnits INTEGER NOT NULL DEFAULT 0
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeNextCreditRequiredUnits INTEGER NOT NULL DEFAULT 1
            """.trimIndent()
        )
        db.execSQL(
            """
            ALTER TABLE progress_series_cache
            ADD COLUMN streakDaysJson TEXT NOT NULL DEFAULT '[]'
            """.trimIndent()
        )
    }
}

val migration21To22: Migration = object : Migration(21, 22) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DELETE FROM progress_summary_cache")
        db.execSQL(
            """
            ALTER TABLE progress_summary_cache
            ADD COLUMN streakFreezeEarnedUnitsPerStreakDay INTEGER NOT NULL DEFAULT 1
            """.trimIndent()
        )
    }
}

val migration22To23: Migration = object : Migration(22, 23) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE review_logs ADD COLUMN reviewedTimeZone TEXT")
    }
}

val migration23To24: Migration = object : Migration(23, 24) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS progress_streak_leaderboard_cache (
                scopeKey TEXT NOT NULL PRIMARY KEY,
                scopeId TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                updatedAtMillis INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }
}

val migration24To25: Migration = object : Migration(24, 25) {
    override fun migrate(db: SupportSQLiteDatabase) {
        rewriteLegacyDeckEffortFilters(db = db)
        appendLegacyEffortTags(db = db)
        rebuildCardsWithoutLegacyEffort(db = db)
    }
}

private data class LegacyCardEffortRow(
    val cardId: String,
    val workspaceId: String,
    val effortTag: String
)

private data class LegacyDeckFilterRow(
    val deckId: String,
    val filterDefinitionJson: String
)

private data class ExistingTagRow(
    val tagId: String
)

private fun appendLegacyEffortTags(db: SupportSQLiteDatabase) {
    loadLegacyEffortCardRows(db = db).forEach { row ->
        val tagId = ensureTagForLegacyEffort(
            db = db,
            workspaceId = row.workspaceId,
            tagName = row.effortTag
        )
        db.execSQL(
            "INSERT OR IGNORE INTO card_tags (cardId, tagId) VALUES (?, ?)",
            arrayOf(row.cardId, tagId)
        )
    }
}

private fun loadLegacyEffortCardRows(db: SupportSQLiteDatabase): List<LegacyCardEffortRow> {
    return db.query(
        SimpleSQLiteQuery(
            """
            SELECT cardId, workspaceId, effortLevel
            FROM cards
            WHERE effortLevel IN ('MEDIUM', 'LONG')
            """.trimIndent()
        )
    ).use { cursor ->
        val cardIdIndex = cursor.getColumnIndexOrThrow("cardId")
        val workspaceIdIndex = cursor.getColumnIndexOrThrow("workspaceId")
        val effortLevelIndex = cursor.getColumnIndexOrThrow("effortLevel")
        val rows = mutableListOf<LegacyCardEffortRow>()

        while (cursor.moveToNext()) {
            val effortTag = when (val effortLevel = cursor.getString(effortLevelIndex)) {
                "MEDIUM" -> legacyMediumEffortTag
                "LONG" -> legacyLongEffortTag
                else -> throw IllegalStateException("Unsupported legacy card effort level in migration 24 to 25: $effortLevel")
            }
            rows.add(
                LegacyCardEffortRow(
                    cardId = cursor.getString(cardIdIndex),
                    workspaceId = cursor.getString(workspaceIdIndex),
                    effortTag = effortTag
                )
            )
        }

        rows.toList()
    }
}

private fun ensureTagForLegacyEffort(
    db: SupportSQLiteDatabase,
    workspaceId: String,
    tagName: String
): String {
    val existingTag = loadExistingTagForNormalizedName(
        db = db,
        workspaceId = workspaceId,
        normalizedName = tagName.lowercase()
    )
    if (existingTag != null) {
        return existingTag.tagId
    }

    val tagId = UUID.randomUUID().toString()
    db.execSQL(
        "INSERT INTO tags (tagId, workspaceId, name) VALUES (?, ?, ?)",
        arrayOf(tagId, workspaceId, tagName)
    )
    return tagId
}

private fun loadExistingTagForNormalizedName(
    db: SupportSQLiteDatabase,
    workspaceId: String,
    normalizedName: String
): ExistingTagRow? {
    return db.query(
        SimpleSQLiteQuery(
            """
            SELECT tagId, name
            FROM tags
            WHERE workspaceId = ? AND lower(name) = ?
            LIMIT 1
            """.trimIndent(),
            arrayOf(workspaceId, normalizedName)
        )
    ).use { cursor ->
        if (cursor.moveToFirst().not()) {
            null
        } else {
            ExistingTagRow(
                tagId = cursor.getString(cursor.getColumnIndexOrThrow("tagId"))
            )
        }
    }
}

private fun rewriteLegacyDeckEffortFilters(db: SupportSQLiteDatabase) {
    loadLegacyDeckFilterRows(db = db).forEach { row ->
        val rewrittenFilterJson = rewriteLegacyDeckFilterJson(
            deckId = row.deckId,
            rawFilterJson = row.filterDefinitionJson
        )
        db.execSQL(
            "UPDATE decks SET filterDefinitionJson = ? WHERE deckId = ?",
            arrayOf(rewrittenFilterJson, row.deckId)
        )
    }
}

private fun loadLegacyDeckFilterRows(db: SupportSQLiteDatabase): List<LegacyDeckFilterRow> {
    return db.query(
        SimpleSQLiteQuery("SELECT deckId, filterDefinitionJson FROM decks")
    ).use { cursor ->
        val deckIdIndex = cursor.getColumnIndexOrThrow("deckId")
        val filterDefinitionJsonIndex = cursor.getColumnIndexOrThrow("filterDefinitionJson")
        val rows = mutableListOf<LegacyDeckFilterRow>()

        while (cursor.moveToNext()) {
            rows.add(
                LegacyDeckFilterRow(
                    deckId = cursor.getString(deckIdIndex),
                    filterDefinitionJson = cursor.getString(filterDefinitionJsonIndex)
                )
            )
        }

        rows.toList()
    }
}

private fun rewriteLegacyDeckFilterJson(deckId: String, rawFilterJson: String): String {
    val jsonObject = try {
        JSONObject(rawFilterJson)
    } catch (error: JSONException) {
        throw IllegalArgumentException("Deck '$deckId' has malformed filterDefinitionJson during migration 24 to 25.", error)
    }
    val version = jsonObject.optInt("version", 2)
    val tags = readLegacyDeckFilterTags(
        deckId = deckId,
        jsonObject = jsonObject
    )
    val effortTags = readLegacyDeckEffortTags(
        deckId = deckId,
        jsonObject = jsonObject
    )
    return JSONObject()
        .put("version", version)
        .put("tags", JSONArray(normalizeLegacyTagList(tags = tags + effortTags)))
        .toString()
}

private fun readLegacyDeckFilterTags(deckId: String, jsonObject: JSONObject): List<String> {
    val tags = jsonObject.optJSONArray("tags") ?: return emptyList()
    return try {
        (0 until tags.length()).map { index ->
            tags.getString(index)
        }
    } catch (error: JSONException) {
        throw IllegalArgumentException("Deck '$deckId' has malformed filterDefinitionJson tags during migration 24 to 25.", error)
    }
}

private fun readLegacyDeckEffortTags(deckId: String, jsonObject: JSONObject): List<String> {
    val effortLevels = jsonObject.optJSONArray("effortLevels") ?: return emptyList()
    return try {
        (0 until effortLevels.length()).mapNotNull { index ->
            when (val effortLevel = effortLevels.getString(index).lowercase()) {
                "fast" -> null
                "medium" -> legacyMediumEffortTag
                "long" -> legacyLongEffortTag
                else -> throw IllegalArgumentException(
                    "Deck '$deckId' has unsupported legacy effort level '$effortLevel' during migration 24 to 25."
                )
            }
        }
    } catch (error: JSONException) {
        throw IllegalArgumentException(
            "Deck '$deckId' has malformed filterDefinitionJson effortLevels during migration 24 to 25.",
            error
        )
    }
}

private fun normalizeLegacyTagList(tags: List<String>): List<String> {
    return tags.fold(emptyList()) { result, tag ->
        val normalizedTag = tag.trim()
        if (normalizedTag.isEmpty()) {
            return@fold result
        }
        if (result.any { existingTag -> existingTag.lowercase() == normalizedTag.lowercase() }) {
            return@fold result
        }

        result + normalizedTag
    }
}

private fun rebuildCardsWithoutLegacyEffort(db: SupportSQLiteDatabase) {
    db.execSQL("CREATE TEMP TABLE card_tags_v25_backup AS SELECT cardId, tagId FROM card_tags")
    db.execSQL(
        """
        CREATE TEMP TABLE review_logs_v25_backup AS
        SELECT
            reviewLogId,
            workspaceId,
            cardId,
            replicaId,
            clientEventId,
            rating,
            reviewedAtMillis,
            reviewedAtServerIso,
            reviewedTimeZone
        FROM review_logs
        """.trimIndent()
    )
    db.execSQL("DROP TABLE card_tags")
    db.execSQL("DROP TABLE review_logs")
    db.execSQL(
        """
        CREATE TABLE IF NOT EXISTS cards_v25 (
            cardId TEXT NOT NULL PRIMARY KEY,
            workspaceId TEXT NOT NULL,
            frontText TEXT NOT NULL,
            backText TEXT NOT NULL,
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
    db.execSQL(
        """
        INSERT INTO cards_v25 (
            cardId,
            workspaceId,
            frontText,
            backText,
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
        )
        SELECT
            cardId,
            workspaceId,
            frontText,
            backText,
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
        FROM cards
        """.trimIndent()
    )
    db.execSQL("DROP TABLE cards")
    db.execSQL("ALTER TABLE cards_v25 RENAME TO cards")
    db.execSQL("CREATE INDEX IF NOT EXISTS index_cards_workspaceId ON cards(workspaceId)")
    db.execSQL(
        """
        CREATE INDEX IF NOT EXISTS $cardsReviewQueueIndexName
        ON cards(workspaceId, dueAtMillis, createdAtMillis, cardId)
        """.trimIndent()
    )
    db.execSQL(
        """
        CREATE INDEX IF NOT EXISTS $cardsRecentlyReviewedDueIndexName
        ON cards(workspaceId, fsrsLastReviewedAtMillis, dueAtMillis, createdAtMillis, cardId)
        """.trimIndent()
    )
    db.execSQL(
        """
        CREATE TABLE IF NOT EXISTS card_tags (
            cardId TEXT NOT NULL,
            tagId TEXT NOT NULL,
            PRIMARY KEY(cardId, tagId),
            FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE,
            FOREIGN KEY(tagId) REFERENCES tags(tagId) ON DELETE CASCADE
        )
        """.trimIndent()
    )
    db.execSQL("CREATE INDEX IF NOT EXISTS index_card_tags_tagId ON card_tags(tagId)")
    db.execSQL("INSERT OR IGNORE INTO card_tags (cardId, tagId) SELECT cardId, tagId FROM card_tags_v25_backup")
    db.execSQL("DROP TABLE card_tags_v25_backup")
    db.execSQL(
        """
        CREATE TABLE IF NOT EXISTS review_logs (
            reviewLogId TEXT NOT NULL PRIMARY KEY,
            workspaceId TEXT NOT NULL,
            cardId TEXT NOT NULL,
            replicaId TEXT NOT NULL,
            clientEventId TEXT NOT NULL,
            rating TEXT NOT NULL,
            reviewedAtMillis INTEGER NOT NULL,
            reviewedAtServerIso TEXT NOT NULL,
            reviewedTimeZone TEXT,
            FOREIGN KEY(workspaceId) REFERENCES workspaces(workspaceId) ON DELETE CASCADE,
            FOREIGN KEY(cardId) REFERENCES cards(cardId) ON DELETE CASCADE
        )
        """.trimIndent()
    )
    db.execSQL(
        """
        INSERT INTO review_logs (
            reviewLogId,
            workspaceId,
            cardId,
            replicaId,
            clientEventId,
            rating,
            reviewedAtMillis,
            reviewedAtServerIso,
            reviewedTimeZone
        )
        SELECT
            reviewLogId,
            workspaceId,
            cardId,
            replicaId,
            clientEventId,
            rating,
            reviewedAtMillis,
            reviewedAtServerIso,
            reviewedTimeZone
        FROM review_logs_v25_backup
        """.trimIndent()
    )
    db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_workspaceId ON review_logs(workspaceId)")
    db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_cardId ON review_logs(cardId)")
    db.execSQL("CREATE INDEX IF NOT EXISTS index_review_logs_reviewedAtMillis ON review_logs(reviewedAtMillis)")
    db.execSQL("DROP TABLE review_logs_v25_backup")
}
