package com.flashcardsopensourceapp.data.local.repository.catalog

import android.util.Log
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.remote.catalog.parseCatalogBrowseIndex
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndex
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexCacheState
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexPointer
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import com.flashcardsopensourceapp.data.local.repository.media.sha256Hex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit

private const val catalogBrowseIndexLogTag: String = "CatalogBrowseIndex"
private const val catalogBrowseIndexCacheDirectoryName: String = "catalog"
private const val catalogBrowseIndexCacheFileName: String = "browse-index.json"
private const val catalogBrowseIndexRevalidateIntervalMillis: Long = 5L * 60L * 1_000L
private const val catalogBrowseIndexDownloadMaxAttemptCount: Int = 3
private const val catalogBrowseIndexDownloadRetryBaseDelayMillis: Long = 500L
private const val catalogBrowseIndexErrorBodyLimit: Int = 4_096

interface CatalogBrowseIndexRepository {
    fun observeCacheState(): StateFlow<CatalogBrowseIndexCacheState>

    /**
     * Publishes the on-device cache first, then checks the server unless the same server was
     * checked in the last five minutes. Throws when the check fails; the cached index stays.
     */
    suspend fun revalidateIfStale()

    /** Checks the server now, even right after a check: a deck page has shown the index is stale. */
    suspend fun revalidateNow()
}

class CatalogBrowseIndexDownloadException(
    message: String,
    val retryEligible: Boolean
) : IOException(message)

class CatalogBrowseIndexIntegrityException(message: String) : IllegalStateException(message)

private data class CatalogBrowseIndexCheck(
    val apiBaseUrl: String,
    val checkedAtElapsedMillis: Long
)

class CloudCatalogBrowseIndexRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteService,
    okHttpClient: OkHttpClient,
    cacheDirectory: File,
    private val elapsedRealtimeMillisProvider: () -> Long
) : CatalogBrowseIndexRepository {
    // No `Accept-Encoding` here: OkHttp decompresses gzip transparently only when it added that
    // header itself, and the CDN always answers with `Content-Encoding: gzip`.
    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val cacheFile: File = File(File(cacheDirectory, catalogBrowseIndexCacheDirectoryName), catalogBrowseIndexCacheFileName)
    private val cacheStateMutable = MutableStateFlow<CatalogBrowseIndexCacheState>(CatalogBrowseIndexCacheState.Loading)
    private val revalidateMutex = Mutex()
    private var cachedSha256: String? = null
    private var lastSuccessfulCheck: CatalogBrowseIndexCheck? = null

    override fun observeCacheState(): StateFlow<CatalogBrowseIndexCacheState> = cacheStateMutable.asStateFlow()

    override suspend fun revalidateIfStale() {
        revalidateMutex.withLock {
            withContext(Dispatchers.IO) {
                if (cacheStateMutable.value == CatalogBrowseIndexCacheState.Loading) {
                    loadCachedIndex()
                }
                val apiBaseUrl = preferencesStore.currentServerConfiguration().apiBaseUrl
                val nowElapsedMillis = elapsedRealtimeMillisProvider()
                val lastCheck = lastSuccessfulCheck
                if (
                    lastCheck != null &&
                    lastCheck.apiBaseUrl == apiBaseUrl &&
                    nowElapsedMillis - lastCheck.checkedAtElapsedMillis < catalogBrowseIndexRevalidateIntervalMillis
                ) {
                    return@withContext
                }
                checkServer(apiBaseUrl = apiBaseUrl, nowElapsedMillis = nowElapsedMillis)
            }
        }
    }

    override suspend fun revalidateNow() {
        revalidateMutex.withLock {
            withContext(Dispatchers.IO) {
                if (cacheStateMutable.value == CatalogBrowseIndexCacheState.Loading) {
                    loadCachedIndex()
                }
                checkServer(
                    apiBaseUrl = preferencesStore.currentServerConfiguration().apiBaseUrl,
                    nowElapsedMillis = elapsedRealtimeMillisProvider()
                )
            }
        }
    }

    private suspend fun checkServer(apiBaseUrl: String, nowElapsedMillis: Long) {
        val pointer = remoteService.loadCatalogBrowseIndexPointer(apiBaseUrl = apiBaseUrl)
        if (pointer.sha256 != cachedSha256) {
            val indexBytes = downloadIndexBytes(pointer = pointer)
            val index = parseCatalogBrowseIndex(json = indexBytes.toString(Charsets.UTF_8))
            writeCacheAtomically(bytes = indexBytes)
            cachedSha256 = pointer.sha256
            cacheStateMutable.value = CatalogBrowseIndexCacheState.Ready(index = index)
        }
        lastSuccessfulCheck = CatalogBrowseIndexCheck(
            apiBaseUrl = apiBaseUrl,
            checkedAtElapsedMillis = nowElapsedMillis
        )
    }

    /**
     * A cache this app version cannot read is deleted and re-downloaded rather than shown: it was
     * validated when written, so only a schema change or file corruption makes it unreadable.
     */
    private fun loadCachedIndex() {
        if (cacheFile.exists().not()) {
            cacheStateMutable.value = CatalogBrowseIndexCacheState.Empty
            return
        }
        val bytes = cacheFile.readBytes()
        val index: CatalogBrowseIndex = try {
            parseCatalogBrowseIndex(json = bytes.toString(Charsets.UTF_8))
        } catch (error: CloudContractMismatchException) {
            Log.w(
                catalogBrowseIndexLogTag,
                "event=catalog_browse_index_cache_unreadable path=${cacheFile.absolutePath} sizeBytes=${bytes.size}",
                error
            )
            if (cacheFile.delete().not()) {
                throw IOException("Cannot delete unreadable catalog browse index cache: ${cacheFile.absolutePath}", error)
            }
            cacheStateMutable.value = CatalogBrowseIndexCacheState.Empty
            return
        }
        cachedSha256 = sha256Hex(bytes = bytes)
        cacheStateMutable.value = CatalogBrowseIndexCacheState.Ready(index = index)
    }

    private suspend fun downloadIndexBytes(pointer: CatalogBrowseIndexPointer): ByteArray {
        var attemptNumber = 1
        while (true) {
            try {
                return downloadIndexBytesAttempt(pointer = pointer)
            } catch (error: IOException) {
                val retryEligible = error !is CatalogBrowseIndexDownloadException || error.retryEligible
                if (retryEligible.not() || attemptNumber >= catalogBrowseIndexDownloadMaxAttemptCount) {
                    throw error
                }
                val delayMillis = catalogBrowseIndexDownloadRetryBaseDelayMillis * attemptNumber
                Log.w(
                    catalogBrowseIndexLogTag,
                    "event=catalog_browse_index_download_retry attemptNumber=$attemptNumber " +
                        "delayMs=$delayMillis errorType=${error::class.java.simpleName} url=${pointer.url}",
                    error
                )
                delay(delayMillis)
                attemptNumber += 1
            }
        }
    }

    private suspend fun downloadIndexBytesAttempt(pointer: CatalogBrowseIndexPointer): ByteArray {
        val request = Request.Builder()
            .url(pointer.url)
            .get()
            .build()
        return httpClient.newCall(request).awaitOkHttpResponse().use { response ->
            if (response.isSuccessful.not()) {
                val responseBody = response.peekBody(byteCount = catalogBrowseIndexErrorBodyLimit.toLong()).string()
                throw CatalogBrowseIndexDownloadException(
                    message = "Catalog browse index download failed: statusCode=${response.code} " +
                        "url=${pointer.url} responseBody=$responseBody",
                    retryEligible = response.code == 408 || response.code == 429 || response.code in 500..599
                )
            }
            // OkHttp removes this header once it has decompressed the body.
            val remainingContentEncoding = response.header("Content-Encoding")
            if (remainingContentEncoding != null) {
                throw CatalogBrowseIndexIntegrityException(
                    "Catalog browse index body was not decompressed: Content-Encoding=$remainingContentEncoding " +
                        "url=${pointer.url}"
                )
            }
            val bytes = response.body.bytes()
            val actualSha256 = sha256Hex(bytes = bytes)
            if (actualSha256 != pointer.sha256) {
                throw CatalogBrowseIndexIntegrityException(
                    "Catalog browse index sha256 mismatch: expected=${pointer.sha256} actual=$actualSha256 " +
                        "sizeBytes=${bytes.size} url=${pointer.url}"
                )
            }
            bytes
        }
    }

    private fun writeCacheAtomically(bytes: ByteArray) {
        val directory = requireNotNull(cacheFile.parentFile) {
            "Catalog browse index cache file must have a parent directory: ${cacheFile.absolutePath}"
        }
        if (directory.exists().not() && directory.mkdirs().not()) {
            throw IOException("Cannot create catalog browse index cache directory: ${directory.absolutePath}")
        }
        val temporaryFile = File(directory, "$catalogBrowseIndexCacheFileName.tmp")
        temporaryFile.writeBytes(bytes)
        Files.move(
            temporaryFile.toPath(),
            cacheFile.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING
        )
    }
}
