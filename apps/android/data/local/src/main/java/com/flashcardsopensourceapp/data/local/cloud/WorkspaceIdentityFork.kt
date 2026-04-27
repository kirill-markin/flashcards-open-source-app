package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

private val cardIdentityForkNamespace: UUID = UUID.fromString("5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1")
private val deckIdentityForkNamespace: UUID = UUID.fromString("98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4")
private val reviewEventIdentityForkNamespace: UUID = UUID.fromString("3a214a3e-9c89-426d-a21f-11a5f5c1d6e8")

internal const val syncWorkspaceForkRequiredErrorCode: String = "SYNC_WORKSPACE_FORK_REQUIRED"

internal data class WorkspaceForkIdMappings(
    val cardIdsBySourceId: Map<String, String>,
    val deckIdsBySourceId: Map<String, String>,
    val reviewEventIdsBySourceId: Map<String, String>
)

internal fun forkedCardId(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceCardId: String
): String {
    return forkedWorkspaceEntityId(
        namespace = cardIdentityForkNamespace,
        sourceWorkspaceId = sourceWorkspaceId,
        destinationWorkspaceId = destinationWorkspaceId,
        sourceEntityId = sourceCardId
    )
}

internal fun forkedDeckId(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceDeckId: String
): String {
    return forkedWorkspaceEntityId(
        namespace = deckIdentityForkNamespace,
        sourceWorkspaceId = sourceWorkspaceId,
        destinationWorkspaceId = destinationWorkspaceId,
        sourceEntityId = sourceDeckId
    )
}

internal fun forkedReviewEventId(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceReviewEventId: String
): String {
    return forkedWorkspaceEntityId(
        namespace = reviewEventIdentityForkNamespace,
        sourceWorkspaceId = sourceWorkspaceId,
        destinationWorkspaceId = destinationWorkspaceId,
        sourceEntityId = sourceReviewEventId
    )
}

private fun forkedWorkspaceEntityId(
    namespace: UUID,
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    sourceEntityId: String
): String {
    if (sourceWorkspaceId == destinationWorkspaceId) {
        return sourceEntityId
    }

    return uuidV5(
        namespace = namespace,
        name = "$sourceWorkspaceId:$destinationWorkspaceId:$sourceEntityId"
    ).toString()
}

private fun uuidV5(namespace: UUID, name: String): UUID {
    val hash = MessageDigest.getInstance("SHA-1").digest(
        namespace.toByteArray() + name.toByteArray(StandardCharsets.UTF_8)
    )
    hash[6] = ((hash[6].toInt() and 0x0f) or 0x50).toByte()
    hash[8] = ((hash[8].toInt() and 0x3f) or 0x80).toByte()
    val buffer = ByteBuffer.wrap(hash, 0, 16)
    return UUID(buffer.long, buffer.long)
}

private fun UUID.toByteArray(): ByteArray {
    return ByteBuffer.allocate(16)
        .putLong(mostSignificantBits)
        .putLong(leastSignificantBits)
        .array()
}

internal fun buildWorkspaceForkIdMappings(
    sourceWorkspaceId: String,
    destinationWorkspaceId: String,
    cards: List<CardEntity>,
    decks: List<DeckEntity>,
    reviewLogs: List<ReviewLogEntity>
): WorkspaceForkIdMappings {
    return WorkspaceForkIdMappings(
        cardIdsBySourceId = cards.associate { card ->
            card.cardId to forkedCardId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceCardId = card.cardId
            )
        },
        deckIdsBySourceId = decks.associate { deck ->
            deck.deckId to forkedDeckId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceDeckId = deck.deckId
            )
        },
        reviewEventIdsBySourceId = reviewLogs.associate { reviewLog ->
            reviewLog.reviewLogId to forkedReviewEventId(
                sourceWorkspaceId = sourceWorkspaceId,
                destinationWorkspaceId = destinationWorkspaceId,
                sourceReviewEventId = reviewLog.reviewLogId
            )
        }
    )
}

internal fun rewriteOutboxEntryForFork(
    entry: OutboxEntryEntity,
    destinationWorkspaceId: String,
    forkMappings: WorkspaceForkIdMappings
): OutboxEntryEntity {
    val payloadJson = JSONObject(entry.payloadJson)
    val entityType = parseSyncEntityType(entry.entityType)
    val rewrittenEntityId = when (entityType) {
        SyncEntityType.CARD -> forkMappings.cardIdsBySourceId.requireMappedId(
            entityType = "card",
            sourceId = entry.entityId
        )

        SyncEntityType.DECK -> forkMappings.deckIdsBySourceId.requireMappedId(
            entityType = "deck",
            sourceId = entry.entityId
        )

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> destinationWorkspaceId

        SyncEntityType.REVIEW_EVENT -> forkMappings.reviewEventIdsBySourceId.requireMappedId(
            entityType = "review_event",
            sourceId = entry.entityId
        )
    }
    when (entityType) {
        SyncEntityType.CARD -> {
            payloadJson.put(
                "cardId",
                forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = payloadJson.requireCloudString("cardId", "fork.outbox.card.cardId")
                )
            )
        }

        SyncEntityType.DECK -> {
            payloadJson.put(
                "deckId",
                forkMappings.deckIdsBySourceId.requireMappedId(
                    entityType = "deck",
                    sourceId = payloadJson.requireCloudString("deckId", "fork.outbox.deck.deckId")
                )
            )
        }

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> Unit

        SyncEntityType.REVIEW_EVENT -> {
            payloadJson.put(
                "reviewEventId",
                forkMappings.reviewEventIdsBySourceId.requireMappedId(
                    entityType = "review_event",
                    sourceId = payloadJson.requireCloudString(
                        "reviewEventId",
                        "fork.outbox.reviewEvent.reviewEventId"
                    )
                )
            )
            payloadJson.put(
                "cardId",
                forkMappings.cardIdsBySourceId.requireMappedId(
                    entityType = "card",
                    sourceId = payloadJson.requireCloudString("cardId", "fork.outbox.reviewEvent.cardId")
                )
            )
        }
    }
    return entry.copy(
        workspaceId = destinationWorkspaceId,
        entityId = rewrittenEntityId,
        payloadJson = payloadJson.toString()
    )
}

internal fun rewriteOutboxEntryForWorkspaceForkEntityReId(
    entry: OutboxEntryEntity,
    entityType: SyncEntityType,
    oldEntityId: String,
    newEntityId: String
): OutboxEntryEntity {
    val entryEntityType = parseSyncEntityType(entry.entityType)
    val payloadJson = JSONObject(entry.payloadJson)
    var rewrittenEntityId = entry.entityId
    var changed = false

    when (entityType) {
        SyncEntityType.CARD -> {
            if (entryEntityType == SyncEntityType.CARD) {
                val payloadCardId = payloadJson.requireCloudString(
                    key = "cardId",
                    fieldPath = "reid.outbox.card.cardId"
                )
                if (entry.entityId == oldEntityId || payloadCardId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("cardId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadCardId != newEntityId
                }
            } else if (entryEntityType == SyncEntityType.REVIEW_EVENT) {
                changed = replaceJsonStringReferenceIfMatches(
                    payloadJson = payloadJson,
                    key = "cardId",
                    oldValue = oldEntityId,
                    newValue = newEntityId,
                    fieldPath = "reid.outbox.reviewEvent.cardId"
                ) || changed
            }
        }

        SyncEntityType.DECK -> {
            if (entryEntityType == SyncEntityType.DECK) {
                val payloadDeckId = payloadJson.requireCloudString(
                    key = "deckId",
                    fieldPath = "reid.outbox.deck.deckId"
                )
                if (entry.entityId == oldEntityId || payloadDeckId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("deckId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadDeckId != newEntityId
                }
            }
        }

        SyncEntityType.REVIEW_EVENT -> {
            if (entryEntityType == SyncEntityType.REVIEW_EVENT) {
                val payloadReviewEventId = payloadJson.requireCloudString(
                    key = "reviewEventId",
                    fieldPath = "reid.outbox.reviewEvent.reviewEventId"
                )
                if (entry.entityId == oldEntityId || payloadReviewEventId == oldEntityId) {
                    rewrittenEntityId = newEntityId
                    payloadJson.put("reviewEventId", newEntityId)
                    changed = entry.entityId != newEntityId || payloadReviewEventId != newEntityId
                }
            }
        }

        SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS -> Unit
    }

    return if (changed) {
        entry.copy(
            entityId = rewrittenEntityId,
            payloadJson = payloadJson.toString()
        )
    } else {
        entry
    }
}

private fun replaceJsonStringReferenceIfMatches(
    payloadJson: JSONObject,
    key: String,
    oldValue: String,
    newValue: String,
    fieldPath: String
): Boolean {
    val currentValue = payloadJson.requireCloudString(key = key, fieldPath = fieldPath)
    if (currentValue != oldValue) {
        return false
    }
    payloadJson.put(key, newValue)
    return true
}

internal fun Map<String, String>.requireMappedId(entityType: String, sourceId: String): String {
    return requireNotNull(this[sourceId]) {
        "Workspace identity fork is missing mapped $entityType id for source id '$sourceId'."
    }
}
