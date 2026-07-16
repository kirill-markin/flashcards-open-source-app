package com.flashcardsopensourceapp.data.local.database.migrations

import androidx.room.migration.Migration
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteDatabase
import com.flashcardsopensourceapp.data.local.database.entities.cardsRecentlyReviewedDueIndexName
import com.flashcardsopensourceapp.data.local.database.entities.cardsReviewQueueIndexName
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private const val legacyMediumEffortTag: String = "medium"
private const val legacyLongEffortTag: String = "long"

val migration24To25: Migration = object : Migration(24, 25) {
    override fun migrate(db: SupportSQLiteDatabase) {
        rewriteLegacyDeckEffortFilters(db = db)
        appendLegacyEffortTags(db = db)
        rebuildCardsWithoutLegacyEffort(db = db)
    }
}

val migration25To26: Migration = object : Migration(25, 26) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE cards ADD COLUMN cardType TEXT NOT NULL DEFAULT 'basic'")
        db.execSQL(
            """
            ALTER TABLE cards
            ADD COLUMN metadataJson TEXT NOT NULL DEFAULT '{"version":1,"source":null}'
            """.trimIndent()
        )
        backfillCardMetadataJson(db = db)
    }
}

private data class LegacyCardEffortRow(
    val cardId: String,
    val workspaceId: String,
    val effortTag: String
)

private data class CardMetadataBackfillRow(
    val cardId: String,
    val createdAtMillis: Long
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

private fun backfillCardMetadataJson(db: SupportSQLiteDatabase) {
    loadCardMetadataBackfillRows(db = db).forEach { row ->
        db.execSQL(
            "UPDATE cards SET metadataJson = ? WHERE cardId = ?",
            arrayOf(buildDefaultCardMetadataJson(createdAt = formatIsoTimestamp(row.createdAtMillis)), row.cardId)
        )
    }
}

private fun loadCardMetadataBackfillRows(db: SupportSQLiteDatabase): List<CardMetadataBackfillRow> {
    return db.query(SimpleSQLiteQuery("SELECT cardId, createdAtMillis FROM cards")).use { cursor ->
        val cardIdIndex = cursor.getColumnIndexOrThrow("cardId")
        val createdAtMillisIndex = cursor.getColumnIndexOrThrow("createdAtMillis")
        val rows = mutableListOf<CardMetadataBackfillRow>()

        while (cursor.moveToNext()) {
            rows.add(
                CardMetadataBackfillRow(
                    cardId = cursor.getString(cardIdIndex),
                    createdAtMillis = cursor.getLong(createdAtMillisIndex)
                )
            )
        }

        rows.toList()
    }
}

private fun buildDefaultCardMetadataJson(createdAt: String): String {
    return JSONObject()
        .put("version", 1)
        .put(
            "source",
            JSONObject()
                .put("label", JSONObject.NULL)
                .put("author", JSONObject.NULL)
                .put("comment", JSONObject.NULL)
                .put("createdAt", createdAt)
                .put("importedAt", JSONObject.NULL)
                .put("importId", JSONObject.NULL)
        )
        .toString()
}
