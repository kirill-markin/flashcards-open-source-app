package com.flashcardsopensourceapp.data.local.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        WorkspaceEntity::class,
        DeckEntity::class,
        CardEntity::class,
        TagEntity::class,
        CardTagEntity::class,
        ReviewLogEntity::class,
        OutboxEntryEntity::class,
        SyncStateEntity::class
    ],
    version = 2,
    exportSchema = false
)
@TypeConverters(DatabaseTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun workspaceDao(): WorkspaceDao
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
    ).fallbackToDestructiveMigration(dropAllTables = true).build()
}
