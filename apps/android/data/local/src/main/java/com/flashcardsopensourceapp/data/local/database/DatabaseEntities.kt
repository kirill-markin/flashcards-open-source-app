package com.flashcardsopensourceapp.data.local.database

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Junction
import androidx.room.PrimaryKey
import androidx.room.Relation
import com.flashcardsopensourceapp.data.local.model.EffortLevel
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
    val position: Int,
    val createdAtMillis: Long
)

@Entity(
    tableName = "cards",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        ),
        ForeignKey(
            entity = DeckEntity::class,
            parentColumns = ["deckId"],
            childColumns = ["deckId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId"), Index("deckId")]
)
data class CardEntity(
    @PrimaryKey val cardId: String,
    val workspaceId: String,
    val deckId: String,
    val frontText: String,
    val backText: String,
    val effortLevel: EffortLevel,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
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
    val rating: ReviewRating,
    val reviewedAtMillis: Long
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
    val operationType: String,
    val payloadJson: String,
    val createdAtMillis: Long
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val workspaceId: String,
    val lastSyncCursor: String?,
    val lastSyncAttemptAtMillis: Long?
)

data class CardWithRelations(
    @Embedded val card: CardEntity,
    @Relation(
        parentColumn = "deckId",
        entityColumn = "deckId"
    )
    val deck: DeckEntity,
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
