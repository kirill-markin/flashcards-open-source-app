package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration25To26
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration25To26DatabaseName: String = "migration-25-to-26-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration25To26Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration25To26DatabaseName
        )
    }

    @Test
    fun migration25To26AddsCardTypeAndBackfillsMetadataJson(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion25Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration25To26DatabaseName,
            version = 25
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration25To26.migrate(database)

            val metadataJson: String = readMigrationSingleString(
                database = database,
                sql = "SELECT metadataJson FROM cards WHERE cardId = 'card-1'"
            )
            val metadata: JSONObject = JSONObject(metadataJson)
            val source: JSONObject = metadata.getJSONObject("source")

            assertEquals(
                "basic",
                readMigrationSingleString(
                    database = database,
                    sql = "SELECT cardType FROM cards WHERE cardId = 'card-1'"
                )
            )
            assertEquals(1, metadata.getInt("version"))
            assertTrue(source.isNull("label"))
            assertTrue(source.isNull("author"))
            assertTrue(source.isNull("comment"))
            assertEquals("1970-01-01T00:00:01.000Z", source.getString("createdAt"))
            assertTrue(source.isNull("importedAt"))
            assertTrue(source.isNull("importId"))
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion25Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration25To26DatabaseName,
            version = 25
        ) { sqliteDatabase: SQLiteDatabase ->
            sqliteDatabase.execSQL(
                """
                CREATE TABLE cards (
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
                    deletedAtMillis INTEGER
                )
                """.trimIndent()
            )
            sqliteDatabase.execSQL(
                """
                INSERT INTO cards (
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
                ) VALUES (
                    'card-1',
                    'workspace-1',
                    'Question',
                    'Answer',
                    NULL,
                    1000,
                    2000,
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
        }
    }
}
