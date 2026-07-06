package com.flashcardsopensourceapp.data.local.repository.media

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.support.LocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.bootstrapTestWorkspace
import com.flashcardsopensourceapp.data.local.support.closeLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createLocalDatabaseTestRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.time.ZoneId
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LocalManagedMediaAuthoringRepositoryTest {
    private lateinit var runtime: LocalDatabaseTestRuntime
    private var mediaStoreImageUri: Uri? = null
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp() = runBlocking {
        runtime = createLocalDatabaseTestRuntime()
    }

    @After
    fun tearDown() {
        if (::runtime.isInitialized) {
            try {
                mediaStoreImageUri?.let { uri ->
                    deleteMediaStoreImageUri(context = runtime.context, uri = uri)
                }
            } finally {
                closeLocalDatabaseTestRuntime(runtime = runtime)
            }
        }
    }

    @Test
    fun authorManagedImageFromUriPersistsAssetCacheAndQueuedUploadBeforeCardSave(): Unit = runBlocking {
        val nowMillis = 1_800_000L
        val workspaceId: String = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val mediaFileRootDirectory: File = createCleanMediaRootDirectory(
            directoryName = "managed-media-authoring"
        )
        val repository: LocalManagedMediaAuthoringRepository = LocalManagedMediaAuthoringRepository(
            contentResolver = runtime.context.contentResolver,
            database = database,
            preferencesStore = runtime.preferencesStore,
            mediaFileRootDirectory = mediaFileRootDirectory,
            ioDispatcher = Dispatchers.IO,
            timeProvider = FixedTimeProvider(currentTimeMillis = nowMillis)
        )
        val sourceImageUri: Uri = createMediaStoreImageUri(
            context = runtime.context,
            displayName = "managed-media-authoring-${UUID.randomUUID()}.png"
        )
        mediaStoreImageUri = sourceImageUri

        val result: ManagedMediaAuthoringResult = repository.authorManagedImageFromUri(
            uri = sourceImageUri,
            altText = "Front [diagram]\nstep"
        )

        assertEquals(workspaceId, result.workspaceId)
        assertTrue(result.mediaAssetId.isNotBlank())
        assertTrue(result.transferId.isNotBlank())
        assertEquals("![Front (diagram) step](fcasset:${result.mediaAssetId})", result.markdown)
        assertTrue(result.markdown.contains("fcasset:"))

        val mediaAsset: MediaAssetEntity = requireNotNull(
            database.mediaAssetDao().loadMediaAsset(mediaAssetId = result.mediaAssetId)
        )
        assertEquals(result.mediaAssetId, mediaAsset.mediaAssetId)
        assertEquals(workspaceId, mediaAsset.workspaceId)
        assertEquals("image/jpeg", mediaAsset.mimeType)
        assertTrue(mediaAsset.sizeBytes > 0L)
        assertEquals(normalizeMediaSha256(rawSha256 = mediaAsset.sha256), mediaAsset.sha256)
        assertEquals(result.transferId, mediaAsset.lastOperationId)

        val mediaBlobCache: MediaBlobCacheEntity = requireNotNull(
            database.mediaTransferDao().loadMediaBlobCache(sha256 = mediaAsset.sha256)
        )
        val expectedLocalRelativePath: String = buildMediaBlobCacheRelativePath(
            sha256 = mediaAsset.sha256
        )
        assertEquals(mediaAsset.sha256, mediaBlobCache.sha256)
        assertEquals(mediaAsset.mimeType, mediaBlobCache.mimeType)
        assertEquals(mediaAsset.sizeBytes, mediaBlobCache.sizeBytes)
        assertEquals(expectedLocalRelativePath, mediaBlobCache.localRelativePath)
        assertEquals(mediaAsset.mediaAssetId, mediaBlobCache.sourceMediaAssetId)
        val cachedFile: File = File(mediaFileRootDirectory, mediaBlobCache.localRelativePath)
        assertTrue(cachedFile.isFile)
        assertEquals(mediaAsset.sizeBytes, cachedFile.length())

        val mediaTransfer: MediaTransferQueueEntity = requireNotNull(
            database.mediaTransferDao().loadMediaTransfer(transferId = result.transferId)
        )
        assertEquals(result.transferId, mediaTransfer.transferId)
        assertEquals(workspaceId, mediaTransfer.workspaceId)
        assertEquals(mediaAsset.mediaAssetId, mediaTransfer.mediaAssetId)
        assertEquals(MediaTransferKind.UPLOAD.wireKey, mediaTransfer.kind)
        assertEquals(MediaTransferStatus.QUEUED.wireKey, mediaTransfer.status)
        assertEquals(mediaAsset.sha256, mediaTransfer.sha256)
        assertEquals(mediaAsset.mimeType, mediaTransfer.mimeType)
        assertEquals(mediaAsset.sizeBytes, mediaTransfer.sizeBytes)
        assertEquals(expectedLocalRelativePath, mediaTransfer.localRelativePath)
        assertEquals(0, mediaTransfer.attemptCount)
        assertTrue(mediaTransfer.nextAttemptAtMillis <= nowMillis)
        assertNull(mediaTransfer.lastError)
        val dueTransfers: List<MediaTransferQueueEntity> = database.mediaTransferDao().loadDueMediaTransfersByKind(
            workspaceId = workspaceId,
            kind = MediaTransferKind.UPLOAD.wireKey,
            status = MediaTransferStatus.QUEUED.wireKey,
            nowMillis = nowMillis,
            limit = 10
        )
        assertTrue(dueTransfers.any { transfer -> transfer.transferId == result.transferId })
    }

    private fun createCleanMediaRootDirectory(directoryName: String): File {
        val mediaFileRootDirectory = File(runtime.context.filesDir, directoryName)
        if (mediaFileRootDirectory.exists() && mediaFileRootDirectory.deleteRecursively().not()) {
            throw IllegalStateException(
                "Cannot delete existing test media root directory: ${mediaFileRootDirectory.absolutePath}"
            )
        }
        return mediaFileRootDirectory
    }
}

private class FixedTimeProvider(
    private val fixedCurrentTimeMillis: Long
) : TimeProvider {
    override fun currentZoneId(): ZoneId {
        return ZoneId.of("UTC")
    }

    override fun currentTimeMillis(): Long {
        return fixedCurrentTimeMillis
    }
}

private fun createMediaStoreImageUri(
    context: Context,
    displayName: String
): Uri {
    val contentValues: ContentValues = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/flashcards-open-source-app-tests")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri: Uri = requireNotNull(
        context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
    ) {
        "Cannot create test image MediaStore row for displayName=$displayName."
    }

    try {
        val outputStream: OutputStream = requireNotNull(context.contentResolver.openOutputStream(uri, "w")) {
            "Cannot open test image MediaStore output stream for uri=$uri."
        }
        outputStream.use { stream ->
            stream.write(createTestPngBytes())
        }
        val publishValues: ContentValues = ContentValues().apply {
            put(MediaStore.Images.Media.IS_PENDING, 0)
        }
        val updatedRowCount: Int = context.contentResolver.update(uri, publishValues, null, null)
        check(updatedRowCount == 1) {
            "Cannot publish test image MediaStore row: uri=$uri updatedRowCount=$updatedRowCount."
        }
        return uri
    } catch (error: Throwable) {
        deleteCreatedMediaStoreImageUri(context = context, uri = uri, cause = error)
        throw error
    }
}

private fun deleteMediaStoreImageUri(
    context: Context,
    uri: Uri
): Unit {
    val deletedRowCount: Int = context.contentResolver.delete(uri, null, null)
    check(deletedRowCount == 1) {
        "Cannot delete test image MediaStore row: uri=$uri deletedRowCount=$deletedRowCount."
    }
}

private fun deleteCreatedMediaStoreImageUri(
    context: Context,
    uri: Uri,
    cause: Throwable
): Unit {
    val deletedRowCount: Int = context.contentResolver.delete(uri, null, null)
    if (deletedRowCount != 1) {
        cause.addSuppressed(
            IOException("Cannot delete failed test image MediaStore row: uri=$uri deletedRowCount=$deletedRowCount.")
        )
    }
}

private fun createTestPngBytes(): ByteArray {
    val bitmap: Bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
    try {
        bitmap.eraseColor(Color.rgb(0x1f, 0x6f, 0x8b))
        val outputStream: ByteArrayOutputStream = ByteArrayOutputStream()
        val didCompress: Boolean = bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        check(didCompress) {
            "Cannot encode test image as PNG."
        }
        val bytes: ByteArray = outputStream.toByteArray()
        check(bytes.isNotEmpty()) {
            "Test image PNG output must not be empty."
        }
        return bytes
    } finally {
        bitmap.recycle()
    }
}
