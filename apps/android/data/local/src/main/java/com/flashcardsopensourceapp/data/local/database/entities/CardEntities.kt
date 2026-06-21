package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState

internal const val cardsReviewQueueIndexName: String = "index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId"
internal const val cardsRecentlyReviewedDueIndexName: String =
    "index_cards_workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_createdAtMillis_cardId"

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
    indices = [
        Index("workspaceId"),
        Index(
            value = ["workspaceId", "dueAtMillis", "createdAtMillis", "cardId"],
            name = cardsReviewQueueIndexName
        ),
        Index(
            value = [
                "workspaceId",
                "fsrsLastReviewedAtMillis",
                "dueAtMillis",
                "createdAtMillis",
                "cardId"
            ],
            name = cardsRecentlyReviewedDueIndexName
        )
    ]
)
data class CardEntity(
    @PrimaryKey val cardId: String,
    val workspaceId: String,
    val frontText: String,
    val backText: String,
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
