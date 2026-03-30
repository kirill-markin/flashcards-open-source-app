package com.flashcardsopensourceapp.data.local.database

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Junction
import androidx.room.PrimaryKey
import androidx.room.Relation
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewRating

@Entity(tableName = "workspaces")
data class WorkspaceEntity(
    @PrimaryKey val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

@Entity(
    tableName = "decks",
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
data class DeckEntity(
    @PrimaryKey val deckId: String,
    val workspaceId: String,
    val name: String,
    val filterDefinitionJson: String,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val deletedAtMillis: Long?
)

@Entity(
    tableName = "cards",
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
data class CardEntity(
    @PrimaryKey val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
    val effortLevel: EffortLevel,
    val dueAtMillis: Long?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?,
    val deletedAtMillis: Long?
)

@Entity(
    tableName = "tags",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["workspaceId", "name"], unique = true)]
)
data class TagEntity(
    @PrimaryKey val tagId: String,
    val workspaceId: String,
    val name: String
)

@Entity(
    tableName = "card_tags",
    primaryKeys = ["cardId", "tagId"],
    foreignKeys = [
        ForeignKey(
            entity = CardEntity::class,
            parentColumns = ["cardId"],
            childColumns = ["cardId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = TagEntity::class,
            parentColumns = ["tagId"],
            childColumns = ["tagId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("tagId")]
)
data class CardTagEntity(
    val cardId: String,
    val tagId: String
)

@Entity(
    tableName = "review_logs",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = CardEntity::class,
            parentColumns = ["cardId"],
            childColumns = ["cardId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId"), Index("cardId")]
)
data class ReviewLogEntity(
    @PrimaryKey val reviewLogId: String,
    val workspaceId: String,
    val cardId: String,
    val replicaId: String,
    val clientEventId: String,
    val rating: ReviewRating,
    val reviewedAtMillis: Long,
    val reviewedAtServerIso: String
)

@Entity(
    tableName = "workspace_scheduler_settings",
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
data class WorkspaceSchedulerSettingsEntity(
    @PrimaryKey val workspaceId: String,
    val algorithm: String,
    val desiredRetention: Double,
    val learningStepsMinutesJson: String,
    val relearningStepsMinutesJson: String,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean,
    val updatedAtMillis: Long
)

@Entity(
    tableName = "outbox_entries",
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
data class OutboxEntryEntity(
    @PrimaryKey val outboxEntryId: String,
    val workspaceId: String,
    val installationId: String,
    val entityType: String,
    val entityId: String,
    val operationType: String,
    val payloadJson: String,
    val clientUpdatedAtIso: String,
    val createdAtMillis: Long,
    val attemptCount: Int,
    val lastError: String?
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val workspaceId: String,
    val lastSyncCursor: String?,
    val lastReviewSequenceId: Long,
    val hasHydratedHotState: Boolean,
    val hasHydratedReviewHistory: Boolean,
    val lastSyncAttemptAtMillis: Long?,
    val lastSuccessfulSyncAtMillis: Long?,
    val lastSyncError: String?
)

data class CardWithRelations(
    @Embedded val card: CardEntity,
    @Relation(
        parentColumn = "cardId",
        entityColumn = "tagId",
        associateBy = Junction(
            value = CardTagEntity::class,
            parentColumn = "cardId",
            entityColumn = "tagId"
        )
    )
    val tags: List<TagEntity>
)
