package com.flashcardsopensourceapp.data.local.cloud

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

private val cardIdentityForkNamespace: UUID = UUID.fromString("5b0c7f2e-6f2a-4b7e-9e1b-2b5f0a4a91b1")
private val deckIdentityForkNamespace: UUID = UUID.fromString("98e66f2c-d3c7-4e3f-a7df-55d8e19ad2b4")
private val reviewEventIdentityForkNamespace: UUID = UUID.fromString("3a214a3e-9c89-426d-a21f-11a5f5c1d6e8")

internal const val syncWorkspaceForkRequiredErrorCode: String = "SYNC_WORKSPACE_FORK_REQUIRED"

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
