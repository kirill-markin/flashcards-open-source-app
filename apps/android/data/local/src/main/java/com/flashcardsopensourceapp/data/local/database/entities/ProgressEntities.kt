package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "progress_summary_cache")
data class ProgressSummaryCacheEntity(
    @PrimaryKey val scopeKey: String,
    val scopeId: String,
    val timeZone: String,
    val generatedAt: String?,
    val reviewHistoryWatermarksJson: String,
    val currentStreakDays: Int,
    val hasReviewedToday: Boolean,
    val lastReviewedOn: String?,
    val activeReviewDays: Int,
    val updatedAtMillis: Long
)

@Entity(tableName = "progress_series_cache")
data class ProgressSeriesCacheEntity(
    @PrimaryKey val scopeKey: String,
    val scopeId: String,
    val timeZone: String,
    val fromLocalDate: String,
    val toLocalDate: String,
    val generatedAt: String?,
    val reviewHistoryWatermarksJson: String,
    val dailyReviewsJson: String,
    val updatedAtMillis: Long
)

@Entity(tableName = "progress_review_schedule_cache")
data class ProgressReviewScheduleCacheEntity(
    @PrimaryKey val scopeKey: String,
    val scopeId: String,
    val timeZone: String,
    val referenceLocalDate: String,
    val generatedAt: String?,
    val reviewHistoryWatermarksJson: String,
    val totalCards: Int,
    val bucketsJson: String,
    val updatedAtMillis: Long
)

// Caches the last successful compact leaderboard payload per account scope. The raw
// payload JSON keeps the API-provided anonymous display names so offline renders never
// regenerate names on the client.
@Entity(tableName = "progress_leaderboard_cache")
data class ProgressLeaderboardCacheEntity(
    @PrimaryKey val scopeKey: String,
    val scopeId: String,
    val payloadJson: String,
    val updatedAtMillis: Long
)

@Entity(
    tableName = "progress_local_day_counts",
    primaryKeys = ["timeZone", "workspaceId", "localDate"],
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId"), Index("timeZone")]
)
data class ProgressLocalDayCountEntity(
    val timeZone: String,
    val workspaceId: String,
    val localDate: String,
    val reviewCount: Int
)

@Entity(
    tableName = "progress_review_history_state",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId")]
)
data class ProgressReviewHistoryStateEntity(
    @PrimaryKey val workspaceId: String,
    val historyVersion: Long,
    val reviewLogCount: Int,
    val maxReviewedAtMillis: Long
)

@Entity(
    tableName = "progress_local_cache_state",
    primaryKeys = ["timeZone", "workspaceId"],
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId"), Index("timeZone")]
)
data class ProgressLocalCacheStateEntity(
    val timeZone: String,
    val workspaceId: String,
    val historyVersion: Long,
    val updatedAtMillis: Long
)

data class ProgressReviewScheduleCardDueEntity(
    val cardId: String,
    val workspaceId: String,
    val dueAtMillis: Long?
)

// Query projections over review_logs for the leaderboard viewer overlay. Qualified
// reviews are Hard/Good/Easy; Again never counts.
data class ProgressQualifiedReviewWorkspaceCountEntity(
    val workspaceId: String,
    val qualifiedReviewCount: Int
)

data class ProgressQualifiedReviewTimeEntity(
    val workspaceId: String,
    val reviewedAtMillis: Long
)
