package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Embedded
import androidx.room.Junction
import androidx.room.Relation

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
