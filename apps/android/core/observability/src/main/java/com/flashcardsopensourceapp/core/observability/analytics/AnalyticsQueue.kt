package com.flashcardsopensourceapp.core.observability.analytics

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Durable analytics queue on its own Room database.
 *
 * It deliberately does not share `:data:local`: analytics writes must never sit behind the same
 * locks as product sync, because emitting an event may not block, delay or fail a user action.
 */
const val analyticsQueueDatabaseName: String = "flashcards-analytics-queue.db"

@Entity(tableName = "analytics_queued_event")
internal data class AnalyticsQueuedEventEntity(
    @PrimaryKey val eventId: String,
    val eventName: String,
    val eventJson: String,
    val byteSize: Int,
    val createdAtMillis: Long,
    val anonymousId: String,
    val sessionId: String
)

@Dao
internal interface AnalyticsQueueDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: AnalyticsQueuedEventEntity)

    @Query("SELECT COUNT(*) FROM analytics_queued_event")
    suspend fun countEvents(): Int

    @Query("SELECT COALESCE(SUM(byteSize), 0) FROM analytics_queued_event")
    suspend fun totalByteSize(): Long

    /**
     * The oldest row belonging to the current identity. Selection is scoped to `anonymousId` rather
     * than taking the globally oldest row so that a boundary whose delete failed — or that a process
     * death interrupted before the worker ran — cannot put a departed person's events on the wire:
     * the rotation alone is enough to make them unselectable.
     */
    @Query(
        "SELECT * FROM analytics_queued_event WHERE anonymousId = :anonymousId " +
            "ORDER BY createdAtMillis ASC, eventId ASC LIMIT 1"
    )
    suspend fun oldestEventForAnonymousId(anonymousId: String): AnalyticsQueuedEventEntity?

    /**
     * A batch carries one `anonymousId` and one `sessionId` for every event in it, so a batch may
     * only ever contain events created under the same pair.
     */
    @Query(
        "SELECT * FROM analytics_queued_event " +
            "WHERE anonymousId = :anonymousId AND sessionId = :sessionId " +
            "ORDER BY createdAtMillis ASC, eventId ASC LIMIT :limit"
    )
    suspend fun oldestEventsForIdentity(
        anonymousId: String,
        sessionId: String,
        limit: Int
    ): List<AnalyticsQueuedEventEntity>

    @Query("DELETE FROM analytics_queued_event WHERE eventId IN (:eventIds)")
    suspend fun deleteByIds(eventIds: List<String>)

    /**
     * Enforces the identity boundary. `anonymousId` rotates atomically on logout, so a row that no
     * longer matches the current one was created by somebody else and can never be delivered: the
     * server attributes a batch to the credential carrying it, not to the id inside it.
     */
    @Query("DELETE FROM analytics_queued_event WHERE anonymousId <> :anonymousId")
    suspend fun deleteForOtherAnonymousIds(anonymousId: String): Int

    @Query("DELETE FROM analytics_queued_event WHERE createdAtMillis < :cutoffMillis")
    suspend fun deleteExpired(cutoffMillis: Long): Int

    @Query(
        "DELETE FROM analytics_queued_event WHERE eventId IN (" +
            "SELECT eventId FROM analytics_queued_event ORDER BY createdAtMillis ASC, eventId ASC LIMIT :limit" +
            ")"
    )
    suspend fun deleteOldest(limit: Int): Int

    /** Returns how many rows were removed, so a discard at an identity boundary can be reported. */
    @Query("DELETE FROM analytics_queued_event")
    suspend fun deleteAll(): Int
}

@Database(
    entities = [AnalyticsQueuedEventEntity::class],
    version = 1,
    exportSchema = false
)
internal abstract class AnalyticsDatabase : RoomDatabase() {
    abstract fun analyticsQueueDao(): AnalyticsQueueDao
}

internal fun buildAnalyticsDatabase(context: Context): AnalyticsDatabase {
    return Room.databaseBuilder(
        context = context.applicationContext,
        klass = AnalyticsDatabase::class.java,
        name = analyticsQueueDatabaseName
    )
        // Analytics is disposable telemetry, never product data: an unreadable or outdated store
        // is recreated instead of blocking the app or failing a write.
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()
}
