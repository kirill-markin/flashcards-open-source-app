package com.flashcardsopensourceapp.data.local.migrations

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.migrations.migration23To24
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val migration23To24DatabaseName: String = "migration-23-to-24-test.db"

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigration23To24Test {
    @After
    fun tearDown(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        deleteMigrationDatabaseFixture(
            context = context,
            databaseName = migration23To24DatabaseName
        )
    }

    @Test
    fun migration23To24AddsProgressStreakLeaderboardCacheTable(): Unit {
        val context: Context = ApplicationProvider.getApplicationContext()
        createMigrationDatabaseFixture(
            context = context,
            databaseName = migration23To24DatabaseName,
            version = 23,
            configureDatabase = {}
        )

        val openHelper: SupportSQLiteOpenHelper = openMigrationDatabaseAtVersion(
            context = context,
            databaseName = migration23To24DatabaseName,
            version = 23
        )
        val database: SupportSQLiteDatabase = openHelper.writableDatabase

        try {
            migration23To24.migrate(database)

            assertTrue(
                migrationTableExists(
                    database = database,
                    tableName = "progress_streak_leaderboard_cache"
                )
            )
        } finally {
            database.close()
            openHelper.close()
        }
    }
}
