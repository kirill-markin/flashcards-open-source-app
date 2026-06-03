package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating

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
    indices = [Index("workspaceId"), Index("cardId"), Index("reviewedAtMillis")]
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
