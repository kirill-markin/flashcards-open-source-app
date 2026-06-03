package com.flashcardsopensourceapp.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory

internal fun createMigrationDatabaseFixture(
    context: Context,
    databaseName: String,
    version: Int,
    configureDatabase: (SQLiteDatabase) -> Unit
): Unit {
    val databaseFile = context.getDatabasePath(databaseName)
    if (databaseFile.exists()) {
        check(databaseFile.delete()) {
            "Failed to delete existing migration test database at ${databaseFile.absolutePath}"
        }
    }

    val parentFile = databaseFile.parentFile
    if (parentFile != null && !parentFile.exists()) {
        check(parentFile.mkdirs()) {
            "Failed to create migration test database directory at ${parentFile.absolutePath}"
        }
    }

    val sqliteDatabase = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
    try {
        configureDatabase(sqliteDatabase)
        sqliteDatabase.version = version
    } finally {
        sqliteDatabase.close()
    }
}

internal fun deleteMigrationDatabaseFixture(
    context: Context,
    databaseName: String
): Unit {
    val databaseFile = context.getDatabasePath(databaseName)
    if (databaseFile.exists()) {
        check(context.deleteDatabase(databaseName)) {
            "Failed to delete migration test database at ${databaseFile.absolutePath}"
        }
    }
}

internal fun openMigrationDatabaseAtVersion(
    context: Context,
    databaseName: String,
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
        .name(databaseName)
        .callback(callback)
        .build()

    return FrameworkSQLiteOpenHelperFactory().create(configuration)
}

internal fun migrationTableExists(
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

internal fun readMigrationSingleString(
    database: SupportSQLiteDatabase,
    sql: String
): String {
    return database.query(SimpleSQLiteQuery(sql)).use { cursor ->
        cursor.moveToFirst()
        cursor.getString(0)
    }
}

internal fun readMigrationSingleLong(
    database: SupportSQLiteDatabase,
    sql: String
): Long {
    return database.query(SimpleSQLiteQuery(sql)).use { cursor ->
        cursor.moveToFirst()
        cursor.getLong(0)
    }
}

internal fun readMigrationSingleStringByScopeKey(
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

internal fun readMigrationSingleLongByScopeKey(
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

internal fun readMigrationIndexNames(
    database: SupportSQLiteDatabase,
    tableName: String
): List<String> {
    return database.query(SimpleSQLiteQuery("PRAGMA index_list('$tableName')")).use { cursor ->
        val nameColumnIndex = cursor.getColumnIndexOrThrow("name")
        val indexNames = mutableListOf<String>()

        while (cursor.moveToNext()) {
            indexNames.add(cursor.getString(nameColumnIndex))
        }

        indexNames.toList()
    }
}

internal fun readMigrationIndexColumns(
    database: SupportSQLiteDatabase,
    indexName: String
): List<String> {
    return database.query(SimpleSQLiteQuery("PRAGMA index_info('$indexName')")).use { cursor ->
        val nameColumnIndex = cursor.getColumnIndexOrThrow("name")
        val columns = mutableListOf<String>()

        while (cursor.moveToNext()) {
            columns.add(cursor.getString(nameColumnIndex))
        }

        columns.toList()
    }
}
