package com.flashcardsopensourceapp.data.local.seed

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.EffortLevel

private const val demoWorkspaceId: String = "workspace-demo"

class DemoDataSeeder(
    private val database: AppDatabase
) {
    suspend fun seedIfNeeded(currentTimeMillis: Long) {
        if (database.workspaceDao().countWorkspaces() > 0) {
            return
        }

        database.withTransaction {
            database.workspaceDao().insertWorkspace(
                workspace = WorkspaceEntity(
                    workspaceId = demoWorkspaceId,
                    name = "Personal Workspace",
                    createdAtMillis = currentTimeMillis
                )
            )

            val decks = buildDemoDecks(currentTimeMillis = currentTimeMillis)
            val tags = buildDemoTags()
            val cards = buildDemoCards(currentTimeMillis = currentTimeMillis)
            val cardTags = buildDemoCardTags()

            database.deckDao().insertDecks(decks = decks)
            database.tagDao().insertTags(tags = tags)
            database.cardDao().insertCards(cards = cards)
            database.tagDao().insertCardTags(cardTags = cardTags)
            database.outboxDao().insertOutboxEntries(
                entries = listOf(
                    OutboxEntryEntity(
                        outboxEntryId = "outbox-demo-bootstrap",
                        workspaceId = demoWorkspaceId,
                        operationType = "bootstrap-placeholder",
                        payloadJson = """{"status":"draft"}""",
                        createdAtMillis = currentTimeMillis
                    )
                )
            )
            database.syncStateDao().insertSyncState(
                syncState = SyncStateEntity(
                    workspaceId = demoWorkspaceId,
                    lastSyncCursor = null,
                    lastSyncAttemptAtMillis = null
                )
            )
        }
    }
}

private fun buildDemoDecks(currentTimeMillis: Long): List<DeckEntity> {
    return listOf(
        DeckEntity(
            deckId = "deck-kotlin",
            workspaceId = demoWorkspaceId,
            name = "Kotlin Basics",
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("basics")
                )
            ),
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis
        ),
        DeckEntity(
            deckId = "deck-android",
            workspaceId = demoWorkspaceId,
            name = "Android UI",
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("ui")
                )
            ),
            createdAtMillis = currentTimeMillis + 1,
            updatedAtMillis = currentTimeMillis + 1
        ),
        DeckEntity(
            deckId = "deck-study",
            workspaceId = demoWorkspaceId,
            name = "Long-form Study",
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = listOf(EffortLevel.LONG),
                    tags = emptyList()
                )
            ),
            createdAtMillis = currentTimeMillis + 2,
            updatedAtMillis = currentTimeMillis + 2
        )
    )
}

private fun buildDemoTags(): List<TagEntity> {
    return listOf(
        TagEntity(tagId = "tag-basics", workspaceId = demoWorkspaceId, name = "basics"),
        TagEntity(tagId = "tag-grammar", workspaceId = demoWorkspaceId, name = "grammar"),
        TagEntity(tagId = "tag-ui", workspaceId = demoWorkspaceId, name = "ui"),
        TagEntity(tagId = "tag-sqlite", workspaceId = demoWorkspaceId, name = "sqlite")
    )
}

private fun buildDemoCards(currentTimeMillis: Long): List<CardEntity> {
    return listOf(
        demoCard("card-1", "What does val mean in Kotlin?", "A read-only reference.", EffortLevel.FAST, currentTimeMillis),
        demoCard("card-2", "What is a data class?", "A class optimized for immutable value-like data.", EffortLevel.MEDIUM, currentTimeMillis + 1),
        demoCard("card-3", "What does Room wrap on Android?", "SQLite with typed DAO and entity APIs.", EffortLevel.LONG, currentTimeMillis + 2),
        demoCard("card-4", "What is Compose used for?", "Building Android UI declaratively.", EffortLevel.FAST, currentTimeMillis + 3),
        demoCard("card-5", "What is WorkManager for?", "Reliable background work and deferred sync tasks.", EffortLevel.LONG, currentTimeMillis + 4),
        demoCard("card-6", "How do you say 'orange' in Spanish?", "naranja", EffortLevel.FAST, currentTimeMillis + 5),
        demoCard("card-7", "How do you say 'to learn' in Spanish?", "aprender", EffortLevel.MEDIUM, currentTimeMillis + 6),
        demoCard("card-8", "What is a simple greeting in Spanish?", "Hola", EffortLevel.FAST, currentTimeMillis + 7),
        demoCard("card-9", "What is a suspend function?", "A function that can suspend without blocking a thread.", EffortLevel.LONG, currentTimeMillis + 8),
        demoCard("card-10", "What does Material 3 provide?", "Default Android design tokens and components.", EffortLevel.FAST, currentTimeMillis + 9)
    )
}

private fun demoCard(
    cardId: String,
    frontText: String,
    backText: String,
    effortLevel: EffortLevel,
    currentTimeMillis: Long
): CardEntity {
    return CardEntity(
        cardId = cardId,
        workspaceId = demoWorkspaceId,
        frontText = frontText,
        backText = backText,
        effortLevel = effortLevel,
        createdAtMillis = currentTimeMillis,
        updatedAtMillis = currentTimeMillis
    )
}

private fun buildDemoCardTags(): List<CardTagEntity> {
    return listOf(
        CardTagEntity(cardId = "card-1", tagId = "tag-basics"),
        CardTagEntity(cardId = "card-2", tagId = "tag-basics"),
        CardTagEntity(cardId = "card-3", tagId = "tag-sqlite"),
        CardTagEntity(cardId = "card-4", tagId = "tag-ui"),
        CardTagEntity(cardId = "card-5", tagId = "tag-ui"),
        CardTagEntity(cardId = "card-5", tagId = "tag-sqlite"),
        CardTagEntity(cardId = "card-6", tagId = "tag-basics"),
        CardTagEntity(cardId = "card-7", tagId = "tag-grammar"),
        CardTagEntity(cardId = "card-8", tagId = "tag-basics"),
        CardTagEntity(cardId = "card-9", tagId = "tag-basics"),
        CardTagEntity(cardId = "card-10", tagId = "tag-ui")
    )
}
