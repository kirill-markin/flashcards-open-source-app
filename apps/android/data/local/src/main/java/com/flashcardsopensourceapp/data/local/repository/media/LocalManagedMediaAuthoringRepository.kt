package com.flashcardsopensourceapp.data.local.repository.media

import android.content.ContentResolver
import android.net.Uri
import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.managedImageMarkdownReference
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.buildClientWorkspaceReplicaId
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.requireCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

data class ManagedMediaAuthoringResult(
    val workspaceId: String,
    val mediaAssetId: String,
    val transferId: String,
    val markdown: String
) {
    init {
        require(workspaceId.isNotBlank()) {
            "Managed media authoring result workspaceId must not be blank."
        }
        require(mediaAssetId.isNotBlank()) {
            "Managed media authoring result mediaAssetId must not be blank."
        }
        require(transferId.isNotBlank()) {
            "Managed media authoring result transferId must not be blank."
        }
        require(markdown.isNotBlank()) {
            "Managed media authoring result markdown must not be blank."
        }
    }
}

class LocalManagedMediaAuthoringRepository(
    private val contentResolver: ContentResolver,
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val mediaFileRootDirectory: File,
    private val ioDispatcher: CoroutineDispatcher,
    private val timeProvider: TimeProvider
) {
    suspend fun authorManagedImageFromUri(
        uri: Uri,
        altText: String
    ): ManagedMediaAuthoringResult {
        val preparedImage: PreparedManagedImage = prepareManagedImageFromUri(
            contentResolver = contentResolver,
            uri = uri,
            ioDispatcher = ioDispatcher
        )

        return withContext(ioDispatcher) {
            persistManagedImage(
                preparedImage = preparedImage,
                altText = altText
            )
        }
    }

    private suspend fun persistManagedImage(
        preparedImage: PreparedManagedImage,
        altText: String
    ): ManagedMediaAuthoringResult {
        val workspace: WorkspaceEntity = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before adding managed media."
        )
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val nowMillis: Long = timeProvider.currentTimeMillis()
        val mediaAssetId: String = UUID.randomUUID().toString()
        val transferId: String = UUID.randomUUID().toString()
        val localRelativePath: String = buildMediaBlobCacheRelativePath(sha256 = preparedImage.sha256)
        writeManagedMediaBlobCacheFile(
            mediaFileRootDirectory = mediaFileRootDirectory,
            localRelativePath = localRelativePath,
            bytes = preparedImage.bytes
        )

        val mediaAsset = MediaAssetEntity(
            mediaAssetId = mediaAssetId,
            workspaceId = workspace.workspaceId,
            mimeType = preparedImage.mimeType,
            sizeBytes = preparedImage.sizeBytes,
            sha256 = preparedImage.sha256,
            sourceUrl = null,
            createdAtMillis = nowMillis,
            clientUpdatedAtMillis = nowMillis,
            lastModifiedByReplicaId = buildClientWorkspaceReplicaId(
                workspaceId = workspace.workspaceId,
                installationId = cloudSettings.installationId
            ),
            lastOperationId = transferId,
            updatedAtMillis = nowMillis,
            deletedAtMillis = null
        )
        val mediaBlobCache = MediaBlobCacheEntity(
            sha256 = preparedImage.sha256,
            mimeType = preparedImage.mimeType,
            sizeBytes = preparedImage.sizeBytes,
            localRelativePath = localRelativePath,
            createdAtMillis = nowMillis,
            lastAccessedAtMillis = nowMillis,
            sourceMediaAssetId = mediaAssetId
        )
        val mediaTransfer = MediaTransferQueueEntity(
            transferId = transferId,
            workspaceId = workspace.workspaceId,
            mediaAssetId = mediaAssetId,
            kind = MediaTransferKind.UPLOAD.wireKey,
            status = MediaTransferStatus.QUEUED.wireKey,
            sha256 = preparedImage.sha256,
            mimeType = preparedImage.mimeType,
            sizeBytes = preparedImage.sizeBytes,
            localRelativePath = localRelativePath,
            attemptCount = 0,
            nextAttemptAtMillis = nowMillis,
            lastError = null,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        )

        database.withTransaction {
            database.mediaAssetDao().insertMediaAsset(mediaAsset = mediaAsset)
            database.mediaTransferDao().upsertMediaBlobCache(mediaBlobCache = mediaBlobCache)
            database.mediaTransferDao().upsertMediaTransfer(mediaTransfer = mediaTransfer)
        }

        return ManagedMediaAuthoringResult(
            workspaceId = workspace.workspaceId,
            mediaAssetId = mediaAssetId,
            transferId = transferId,
            markdown = managedImageMarkdownReference(
                mediaAssetId = mediaAssetId,
                altText = altText
            )
        )
    }
}

private fun writeManagedMediaBlobCacheFile(
    mediaFileRootDirectory: File,
    localRelativePath: String,
    bytes: ByteArray
) {
    val targetFile: File = resolveManagedMediaBlobCacheFile(
        mediaFileRootDirectory = mediaFileRootDirectory,
        localRelativePath = localRelativePath
    )
    val parentDirectory: File = requireNotNull(targetFile.parentFile) {
        "Managed media cache target file must have a parent directory: ${targetFile.absolutePath}"
    }
    if (parentDirectory.exists().not() && parentDirectory.mkdirs().not()) {
        throw IOException("Cannot create managed media cache directory: ${parentDirectory.absolutePath}")
    }

    val temporaryFile = File(
        parentDirectory,
        "${targetFile.name}.${UUID.randomUUID()}.tmp"
    )
    try {
        FileOutputStream(temporaryFile).use { outputStream ->
            outputStream.write(bytes)
        }
        if (targetFile.exists() && targetFile.delete().not()) {
            throw IOException("Cannot replace managed media cache file: ${targetFile.absolutePath}")
        }
        if (temporaryFile.renameTo(targetFile).not()) {
            throw IOException(
                "Cannot move managed media cache file '${temporaryFile.absolutePath}' " +
                    "to '${targetFile.absolutePath}'."
            )
        }
    } catch (error: Throwable) {
        deleteTemporaryManagedMediaFile(
            temporaryFile = temporaryFile,
            cause = error
        )
        throw error
    }
}

private fun resolveManagedMediaBlobCacheFile(
    mediaFileRootDirectory: File,
    localRelativePath: String
): File {
    val rootDirectory: File = mediaFileRootDirectory.canonicalFile
    val cacheFile: File = File(rootDirectory, localRelativePath).canonicalFile
    val rootPath: String = rootDirectory.path
    val cacheFilePath: String = cacheFile.path
    if (cacheFilePath != rootPath && cacheFilePath.startsWith(prefix = "$rootPath${File.separator}").not()) {
        throw IOException(
            "Managed media cache path escapes file root: root='$rootPath' relativePath='$localRelativePath'."
        )
    }
    return cacheFile
}

private fun deleteTemporaryManagedMediaFile(
    temporaryFile: File,
    cause: Throwable
) {
    if (temporaryFile.exists() && temporaryFile.delete().not()) {
        cause.addSuppressed(
            IOException("Cannot delete temporary managed media cache file: ${temporaryFile.absolutePath}")
        )
    }
}
