package com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

private const val workspaceReplicaUuidByteCount: Int = 16

internal fun buildClientWorkspaceReplicaId(
    workspaceId: String,
    installationId: String
): String {
    require(workspaceId.isNotBlank()) {
        "Workspace replica id derivation requires a workspace id."
    }
    require(installationId.isNotBlank()) {
        "Workspace replica id derivation requires an installation id."
    }

    val seedBytes: ByteArray = "$workspaceId:$installationId".toByteArray(StandardCharsets.UTF_8)
    val digestBytes: ByteArray = MessageDigest.getInstance("SHA-256").digest(seedBytes)
    digestBytes[6] = ((digestBytes[6].toInt() and 0x0f) or 0x50).toByte()
    digestBytes[8] = ((digestBytes[8].toInt() and 0x3f) or 0x80).toByte()

    val replicaUuidBytes: ByteArray = digestBytes.copyOfRange(0, workspaceReplicaUuidByteCount)
    val replicaUuidBuffer: ByteBuffer = ByteBuffer.wrap(replicaUuidBytes)
    return UUID(replicaUuidBuffer.long, replicaUuidBuffer.long).toString()
}
