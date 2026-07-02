package com.flashcardsopensourceapp.data.local.review

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.review.DownloadedReviewMediaAsset
import com.flashcardsopensourceapp.data.local.repository.review.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.review.ReviewMediaAssetDownloader
import com.flashcardsopensourceapp.data.local.repository.review.ReviewMediaAssetDownloadUrlLoader
import com.flashcardsopensourceapp.data.local.repository.shared.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.support.LocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.bootstrapTestWorkspace
import com.flashcardsopensourceapp.data.local.support.closeLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createLocalDatabaseTestRuntime
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class LocalReviewMediaCacheContractTest {
    private lateinit var runtime: LocalDatabaseTestRuntime
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp() = runBlocking {
        runtime = createLocalDatabaseTestRuntime()
    }

    @After
    fun tearDown() {
        if (::runtime.isInitialized) {
            closeLocalDatabaseTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun reviewMediaFileUsesValidCacheWithoutRequestingSignedUrl(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val mediaBytes: ByteArray = "cached image bytes".toByteArray()
        val mediaAsset: MediaAssetEntity = makeReviewMediaAssetEntity(
            mediaAssetId = "media-cache-hit",
            workspaceId = workspaceId,
            mimeType = "image/png",
            bytes = mediaBytes,
            createdAtMillis = 110L,
            deletedAtMillis = null
        )
        database.mediaAssetDao().insertMediaAsset(mediaAsset = mediaAsset)

        val cacheRootDirectory: File = createCleanCacheRootDirectory(directoryName = "review-media-cache-hit")
        val localRelativePath: String = buildMediaBlobCacheRelativePath(sha256 = mediaAsset.sha256)
        val cachedFile = File(cacheRootDirectory, localRelativePath)
        createParentDirectory(file = cachedFile)
        cachedFile.writeBytes(mediaBytes)
        database.mediaTransferDao().upsertMediaBlobCache(
            mediaBlobCache = MediaBlobCacheEntity(
                sha256 = mediaAsset.sha256,
                mimeType = mediaAsset.mimeType,
                sizeBytes = mediaAsset.sizeBytes,
                localRelativePath = localRelativePath,
                createdAtMillis = 120L,
                lastAccessedAtMillis = 130L,
                sourceMediaAssetId = mediaAsset.mediaAssetId
            )
        )
        val repository: ReviewRepository = createReviewMediaRepository(
            cacheRootDirectory = cacheRootDirectory,
            downloadUrlLoader = ThrowingReviewMediaAssetDownloadUrlLoader,
            downloader = ThrowingReviewMediaAssetDownloader
        )

        val mediaFile = repository.loadReviewMediaAssetFile(mediaAssetId = " ${mediaAsset.mediaAssetId} ")

        assertEquals(mediaAsset.mediaAssetId, mediaFile.mediaAsset.mediaAssetId)
        assertEquals(Uri.fromFile(cachedFile.canonicalFile).toString(), mediaFile.uri)
        val updatedCache: MediaBlobCacheEntity = requireNotNull(
            database.mediaTransferDao().loadMediaBlobCache(sha256 = mediaAsset.sha256)
        )
        assertTrue(updatedCache.lastAccessedAtMillis > 130L)
    }

    @Test
    fun reviewMediaFileDownloadsVerifiesAndPersistsCacheOnMiss(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 200L)
        val mediaBytes: ByteArray = "downloaded image bytes".toByteArray()
        val mediaAsset: MediaAssetEntity = makeReviewMediaAssetEntity(
            mediaAssetId = "media-cache-miss",
            workspaceId = workspaceId,
            mimeType = "image/jpeg",
            bytes = mediaBytes,
            createdAtMillis = 210L,
            deletedAtMillis = null
        )
        database.mediaAssetDao().insertMediaAsset(mediaAsset = mediaAsset)

        val signedDownloadUrl: String = "https://signed.example/review-media-cache-miss"
        val downloadUrlLoader = FakeReviewMediaAssetDownloadUrlLoader(
            responsesByMediaAssetId = mapOf(
                mediaAsset.mediaAssetId to MediaAssetDownloadUrl(
                    mediaAsset = toReviewMediaAsset(mediaAsset = mediaAsset),
                    url = signedDownloadUrl,
                    expiresAtMillis = 500L
                )
            )
        )
        val downloader = FakeReviewMediaAssetDownloader(
            bytesByUrl = mapOf(signedDownloadUrl to mediaBytes)
        )
        val cacheRootDirectory: File = createCleanCacheRootDirectory(directoryName = "review-media-cache-miss")
        val repository: ReviewRepository = createReviewMediaRepository(
            cacheRootDirectory = cacheRootDirectory,
            downloadUrlLoader = downloadUrlLoader,
            downloader = downloader
        )

        val mediaFile = repository.loadReviewMediaAssetFile(mediaAssetId = mediaAsset.mediaAssetId)

        val cachedFile: File = File(
            cacheRootDirectory,
            buildMediaBlobCacheRelativePath(sha256 = mediaAsset.sha256)
        ).canonicalFile
        assertEquals(Uri.fromFile(cachedFile).toString(), mediaFile.uri)
        assertArrayEquals(mediaBytes, cachedFile.readBytes())
        val mediaBlobCache: MediaBlobCacheEntity = requireNotNull(
            database.mediaTransferDao().loadMediaBlobCache(sha256 = mediaAsset.sha256)
        )
        assertEquals(mediaAsset.mediaAssetId, mediaBlobCache.sourceMediaAssetId)
        assertEquals(mediaAsset.sizeBytes, mediaBlobCache.sizeBytes)
        assertEquals(
            listOf(ReviewMediaAssetDownloadRequest(workspaceId = workspaceId, mediaAssetId = mediaAsset.mediaAssetId)),
            downloadUrlLoader.requests
        )
        assertEquals(listOf(signedDownloadUrl), downloader.downloadedUrls)
    }

    @Test
    fun reviewMediaFileRejectsDeletedMediaAsset(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 300L)
        val mediaBytes: ByteArray = "deleted image bytes".toByteArray()
        val mediaAsset: MediaAssetEntity = makeReviewMediaAssetEntity(
            mediaAssetId = "media-deleted",
            workspaceId = workspaceId,
            mimeType = "image/png",
            bytes = mediaBytes,
            createdAtMillis = 310L,
            deletedAtMillis = 320L
        )
        database.mediaAssetDao().insertMediaAsset(mediaAsset = mediaAsset)
        val repository: ReviewRepository = createReviewMediaRepository(
            cacheRootDirectory = createCleanCacheRootDirectory(directoryName = "review-media-cache-deleted"),
            downloadUrlLoader = ThrowingReviewMediaAssetDownloadUrlLoader,
            downloader = ThrowingReviewMediaAssetDownloader
        )

        try {
            repository.loadReviewMediaAssetFile(mediaAssetId = mediaAsset.mediaAssetId)
            fail("Deleted review media asset should not load as a cached file.")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message.orEmpty().contains("Cannot load deleted media asset"))
        }
    }

    private fun createReviewMediaRepository(
        cacheRootDirectory: File,
        downloadUrlLoader: ReviewMediaAssetDownloadUrlLoader,
        downloader: ReviewMediaAssetDownloader
    ): ReviewRepository {
        return LocalReviewRepository(
            database = runtime.database,
            preferencesStore = runtime.preferencesStore,
            syncLocalStore = runtime.syncLocalStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = runtime.database,
                timeProvider = SystemTimeProvider
            ),
            timeProvider = SystemTimeProvider,
            mediaAssetFileCacheRootDirectory = cacheRootDirectory,
            mediaAssetDownloadUrlLoader = downloadUrlLoader,
            mediaAssetDownloader = downloader
        )
    }

    private fun createCleanCacheRootDirectory(directoryName: String): File {
        val cacheRootDirectory = File(runtime.context.filesDir, directoryName)
        if (cacheRootDirectory.exists() && cacheRootDirectory.deleteRecursively().not()) {
            throw IllegalStateException("Cannot delete existing test media cache directory: ${cacheRootDirectory.absolutePath}")
        }
        return cacheRootDirectory
    }

    private fun createParentDirectory(file: File): Unit {
        val parentDirectory = requireNotNull(file.parentFile) {
            "Test file must have a parent directory: ${file.absolutePath}"
        }
        if (parentDirectory.exists().not() && parentDirectory.mkdirs().not()) {
            throw IllegalStateException("Cannot create test media cache directory: ${parentDirectory.absolutePath}")
        }
    }
}

private data class ReviewMediaAssetDownloadRequest(
    val workspaceId: String,
    val mediaAssetId: String
)

private class FakeReviewMediaAssetDownloadUrlLoader(
    private val responsesByMediaAssetId: Map<String, MediaAssetDownloadUrl>
) : ReviewMediaAssetDownloadUrlLoader {
    val requests: MutableList<ReviewMediaAssetDownloadRequest> = mutableListOf()

    override suspend fun loadMediaAssetDownloadUrl(
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        requests += ReviewMediaAssetDownloadRequest(
            workspaceId = workspaceId,
            mediaAssetId = mediaAssetId
        )
        return requireNotNull(responsesByMediaAssetId[mediaAssetId]) {
            "Missing fake review media download URL response for mediaAssetId=$mediaAssetId workspaceId=$workspaceId."
        }
    }
}

private class FakeReviewMediaAssetDownloader(
    private val bytesByUrl: Map<String, ByteArray>
) : ReviewMediaAssetDownloader {
    val downloadedUrls: MutableList<String> = mutableListOf()

    override suspend fun downloadMediaAsset(
        url: String,
        targetFile: File,
        expectedSizeBytes: Long,
        expectedSha256: String
    ): DownloadedReviewMediaAsset {
        downloadedUrls += url
        val bytes: ByteArray = requireNotNull(bytesByUrl[url]) {
            "Missing fake review media bytes for url=$url."
        }
        val actualSha256: String = sha256Hex(bytes = bytes)
        require(expectedSizeBytes == bytes.size.toLong()) {
            "Fake review media expected sizeBytes mismatch for url=$url: " +
                "expectedSizeBytes=$expectedSizeBytes actualSizeBytes=${bytes.size}."
        }
        require(expectedSha256 == actualSha256) {
            "Fake review media expected SHA-256 mismatch for url=$url: " +
                "expectedSha256=$expectedSha256 actualSha256=$actualSha256."
        }
        targetFile.writeBytes(bytes)
        return DownloadedReviewMediaAsset(
            sizeBytes = bytes.size.toLong(),
            sha256 = actualSha256
        )
    }
}

private object ThrowingReviewMediaAssetDownloadUrlLoader : ReviewMediaAssetDownloadUrlLoader {
    override suspend fun loadMediaAssetDownloadUrl(
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        throw AssertionError(
            "Review media cache hit should not request a signed URL. " +
                "workspaceId=$workspaceId mediaAssetId=$mediaAssetId"
        )
    }
}

private object ThrowingReviewMediaAssetDownloader : ReviewMediaAssetDownloader {
    override suspend fun downloadMediaAsset(
        url: String,
        targetFile: File,
        expectedSizeBytes: Long,
        expectedSha256: String
    ): DownloadedReviewMediaAsset {
        throw AssertionError(
            "Review media cache hit should not download bytes. " +
                "url=$url targetFile=${targetFile.absolutePath} expectedSizeBytes=$expectedSizeBytes " +
                "expectedSha256=$expectedSha256"
        )
    }
}

private fun makeReviewMediaAssetEntity(
    mediaAssetId: String,
    workspaceId: String,
    mimeType: String,
    bytes: ByteArray,
    createdAtMillis: Long,
    deletedAtMillis: Long?
): MediaAssetEntity {
    return MediaAssetEntity(
        mediaAssetId = mediaAssetId,
        workspaceId = workspaceId,
        mimeType = mimeType,
        sizeBytes = bytes.size.toLong(),
        sha256 = sha256Hex(bytes = bytes),
        sourceUrl = null,
        createdAtMillis = createdAtMillis,
        clientUpdatedAtMillis = createdAtMillis,
        lastModifiedByReplicaId = "android-test-replica",
        lastOperationId = "$mediaAssetId-operation",
        updatedAtMillis = createdAtMillis,
        deletedAtMillis = deletedAtMillis
    )
}

private fun toReviewMediaAsset(mediaAsset: MediaAssetEntity): MediaAsset {
    return MediaAsset(
        mediaAssetId = mediaAsset.mediaAssetId,
        workspaceId = mediaAsset.workspaceId,
        mimeType = mediaAsset.mimeType,
        sizeBytes = mediaAsset.sizeBytes,
        sha256 = mediaAsset.sha256,
        sourceUrl = mediaAsset.sourceUrl,
        createdAtMillis = mediaAsset.createdAtMillis,
        clientUpdatedAtMillis = mediaAsset.clientUpdatedAtMillis,
        lastModifiedByReplicaId = mediaAsset.lastModifiedByReplicaId,
        lastOperationId = mediaAsset.lastOperationId,
        updatedAtMillis = mediaAsset.updatedAtMillis,
        deletedAtMillis = mediaAsset.deletedAtMillis
    )
}

private fun sha256Hex(bytes: ByteArray): String {
    val digest: ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
    val hexChars: CharArray = "0123456789abcdef".toCharArray()
    val result = CharArray(size = digest.size * 2)
    digest.forEachIndexed { index, byte ->
        val value = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}
