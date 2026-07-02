package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration28To29
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration28To29DatabaseName: String = "migration-28-to-29-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration28To29Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration28To29DatabaseName
        )
    }

    @Test
    fun migration28To29AddsMediaCacheAndTransferQueueTables(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createVersion28Database(context = context)

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration28To29DatabaseName,
            version = 28
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration28To29.migrate(database)

            assertTrue(
                migrationTableExists(
                    database = database,
                    tableName = "media_blob_cache"
                )
            )
            assertTrue(
                migrationTableExists(
                    database = database,
                    tableName = "media_transfer_queue"
                )
            )
            assertEquals(
                listOf("workspaceId", "status", "nextAttemptAtMillis", "createdAtMillis"),
                readMigrationIndexColumns(
                    database = database,
                    indexName = "index_media_transfer_queue_workspaceId_status_nextAttemptAtMillis_createdAtMillis"
                )
            )
            assertEquals(
                listOf("localRelativePath"),
                readMigrationIndexColumns(
                    database = database,
                    indexName = "index_media_blob_cache_localRelativePath"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }

    private fun createVersion28Database(context: Context): Unit {
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration28To29DatabaseName,
            version = 28
        ) { sqliteDatabase: SQLiteDatabase ->
            sqliteDatabase.execSQL(
                """
                CREATE TABLE workspaces (
                    workspaceId TEXT NOT NULL PRIMARY KEY,
                    name TEXT NOT NULL,
                    createdAtMillis INTEGER NOT NULL
                )
                """.trimIndent()
            )
        }
    }
}
