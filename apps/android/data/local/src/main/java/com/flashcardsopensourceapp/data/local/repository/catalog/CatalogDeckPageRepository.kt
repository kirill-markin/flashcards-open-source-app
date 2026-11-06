package com.flashcardsopensourceapp.data.local.repository.catalog

import android.util.Log
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteService
import com.flashcardsopensourceapp.data.local.cloud.remote.catalog.parseCatalogDeckPage
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckPage
import com.flashcardsopensourceapp.data.local.model.catalog.CatalogDeckUnavailableException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

private const val catalogDeckPageLogTag: String = "CatalogDeckPage"
private const val catalogDeckPageCacheDirectoryName: String = "catalog/decks"
private const val catalogDeckPageCacheMaxEntryCount: Int = 50
private const val catalogDeckPreviewCardLimit: Int = 10
private const val cachedPackageDetailKey: String = "packageDetail"
private const val cachedCardPreviewKey: String = "cardPreview"

private val catalogDeckUnavailableErrorCodes: Set<String> = setOf(
    "CATALOG_PUBLIC_PACKAGE_NOT_FOUND",
    "CATALOG_PUBLIC_PACKAGE_VERSION_NOT_FOUND",
    "CATALOG_PACKAGE_VERSION_NOT_FOUND",
    "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED"
)

interface CatalogDeckPageRepository {
    /**
     * Returns the cached page for the deck's package version, or loads and caches it. Throws
     * [CatalogDeckUnavailableException] when the server no longer publishes the deck.
     */
    suspend fun loadDeckPage(deck: CatalogBrowseIndexDeck): CatalogDeckPage

    /** Loads the pages not cached yet, one deck at a time; a failure is logged and skipped. */
    suspend fun prefetchDeckPages(decks: List<CatalogBrowseIndexDeck>)
}

/**
 * A package version is immutable once published, so a cached page never needs revalidating: a newer
 * version arrives as a new index entry with its own `packageVersionId`.
 */
class CloudCatalogDeckPageRepository(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteService,
    cacheDirectory: File
) : CatalogDeckPageRepository {
    private val cacheDirectory: File = File(cacheDirectory, catalogDeckPageCacheDirectoryName)
    private val memoryCacheMutex = Mutex()
    private val memoryCache = LinkedHashMap<String, CatalogDeckPage>(
        catalogDeckPageCacheMaxEntryCount,
        0.75f,
        true
    )
    private val diskCacheMutex = Mutex()

    override suspend fun loadDeckPage(deck: CatalogBrowseIndexDeck): CatalogDeckPage {
        val memoryPage = memoryCacheMutex.withLock { memoryCache[deck.packageVersionId] }
        if (memoryPage != null) {
            return memoryPage
        }
        val page = readDiskPage(packageVersionId = deck.packageVersionId) ?: loadRemotePage(deck = deck)
        memoryCacheMutex.withLock {
            memoryCache[deck.packageVersionId] = page
            if (memoryCache.size > catalogDeckPageCacheMaxEntryCount) {
                memoryCache.remove(memoryCache.keys.first())
            }
        }
        return page
    }

    override suspend fun prefetchDeckPages(decks: List<CatalogBrowseIndexDeck>) {
        decks.forEach { deck ->
            try {
                loadDeckPage(deck = deck)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                Log.w(
                    catalogDeckPageLogTag,
                    "event=catalog_deck_page_prefetch_failed packageVersionId=${deck.packageVersionId} slug=${deck.slug}",
                    error
                )
            }
        }
    }

    private suspend fun loadRemotePage(deck: CatalogBrowseIndexDeck): CatalogDeckPage {
        val apiBaseUrl = preferencesStore.currentServerConfiguration().apiBaseUrl
        val (packageDetailResponse, cardPreviewResponse) = try {
            coroutineScope {
                val packageDetail = async {
                    remoteService.loadCatalogPackageDetailResponse(apiBaseUrl = apiBaseUrl, packageSlug = deck.slug)
                }
                val cardPreview = async {
                    remoteService.loadCatalogCardPreviewResponse(
                        apiBaseUrl = apiBaseUrl,
                        packageVersionId = deck.packageVersionId,
                        limit = catalogDeckPreviewCardLimit
                    )
                }
                packageDetail.await() to cardPreview.await()
            }
        } catch (error: CloudRemoteException) {
            throw catalogDeckUnavailableOrSelf(error = error, deck = deck)
        }
        val page = parseCatalogDeckPage(
            packageVersionId = deck.packageVersionId,
            packageDetailResponse = packageDetailResponse,
            cardPreviewResponse = cardPreviewResponse
        )
        try {
            writeDiskPage(
                packageVersionId = deck.packageVersionId,
                entry = JSONObject()
                    .put(cachedPackageDetailKey, packageDetailResponse)
                    .put(cachedCardPreviewKey, cardPreviewResponse)
            )
        } catch (error: IOException) {
            Log.w(
                catalogDeckPageLogTag,
                "event=catalog_deck_page_cache_write_failed packageVersionId=${deck.packageVersionId} " +
                    "path=${cacheDirectory.absolutePath}",
                error
            )
        }
        return page
    }

    /** An entry this app version or the disk cannot read is deleted and loaded again rather than shown. */
    private suspend fun readDiskPage(packageVersionId: String): CatalogDeckPage? = diskCacheMutex.withLock {
        withContext(Dispatchers.IO) {
            val file = cacheFile(packageVersionId = packageVersionId)
            if (file.exists().not()) {
                return@withContext null
            }
            try {
                val entry = JSONObject(file.readText(Charsets.UTF_8))
                parseCatalogDeckPage(
                    packageVersionId = packageVersionId,
                    packageDetailResponse = entry.requireCloudObject(cachedPackageDetailKey, "catalogDeckPageCache.$cachedPackageDetailKey"),
                    cardPreviewResponse = entry.requireCloudObject(cachedCardPreviewKey, "catalogDeckPageCache.$cachedCardPreviewKey")
                )
            } catch (error: JSONException) {
                discardUnreadableDiskPage(file = file, error = error)
            } catch (error: CloudContractMismatchException) {
                discardUnreadableDiskPage(file = file, error = error)
            } catch (error: IOException) {
                discardUnreadableDiskPage(file = file, error = error)
            }
        }
    }

    private fun discardUnreadableDiskPage(file: File, error: Exception): CatalogDeckPage? {
        Log.w(
            catalogDeckPageLogTag,
            "event=catalog_deck_page_cache_unreadable path=${file.absolutePath} sizeBytes=${file.length()}",
            error
        )
        // The network load writes over an entry that stays.
        if (file.delete().not()) {
            Log.w(catalogDeckPageLogTag, "event=catalog_deck_page_cache_delete_failed path=${file.absolutePath}")
        }
        return null
    }

    private suspend fun writeDiskPage(packageVersionId: String, entry: JSONObject): Unit = diskCacheMutex.withLock {
        withContext(Dispatchers.IO) {
            if (cacheDirectory.exists().not() && cacheDirectory.mkdirs().not()) {
                throw IOException("Cannot create catalog deck page cache directory: ${cacheDirectory.absolutePath}")
            }
            val file = cacheFile(packageVersionId = packageVersionId)
            val temporaryFile = File(cacheDirectory, "${file.name}.tmp")
            temporaryFile.writeText(entry.toString(), Charsets.UTF_8)
            Files.move(
                temporaryFile.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
            )
            dropOldestDiskPages()
        }
    }

    private fun dropOldestDiskPages() {
        val files = cacheDirectory.listFiles { file -> file.name.endsWith(".json") }
            ?: throw IOException("Cannot list catalog deck page cache directory: ${cacheDirectory.absolutePath}")
        files.sortedBy(File::lastModified)
            .take((files.size - catalogDeckPageCacheMaxEntryCount).coerceAtLeast(0))
            .forEach { file ->
                if (file.delete().not()) {
                    throw IOException("Cannot delete old catalog deck page cache entry: ${file.absolutePath}")
                }
            }
    }

    private fun cacheFile(packageVersionId: String): File {
        require(catalogPackageVersionIdPattern.matches(packageVersionId)) {
            "Catalog packageVersionId must be a UUID to name a cache file: \"$packageVersionId\""
        }
        return File(cacheDirectory, "$packageVersionId.json")
    }
}

private val catalogPackageVersionIdPattern: Regex = Regex("^[0-9a-fA-F-]{36}$")

/** Maps the server's "not published" answers for this deck to [CatalogDeckUnavailableException]. */
internal fun catalogDeckUnavailableOrSelf(error: CloudRemoteException, deck: CatalogBrowseIndexDeck): Exception {
    if (error.errorCode !in catalogDeckUnavailableErrorCodes) {
        return error
    }
    return CatalogDeckUnavailableException(
        message = "Catalog deck is no longer published: packageVersionId=${deck.packageVersionId} " +
            "slug=${deck.slug} statusCode=${error.statusCode} errorCode=${error.errorCode}",
        cause = error
    )
}
