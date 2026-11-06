import Foundation
import Observation
import OSLog

private let catalogBrowseIndexCacheFileName: String = "catalog-browse-index.json"
private let catalogBrowseIndexRevalidationInterval: TimeInterval = 5 * 60
let catalogDeckPreviewPrefetchCount: Int = 10

private let catalogIndexStoreLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "catalog_index_store"
)

/// App-owned public catalog index: the cached copy is shown at once, then revalidated against
/// the pointer. The cache file holds the index JSON exactly as downloaded, so its SHA-256 is
/// the pointer digest it was verified against. It also loads deck page previews, so a prefetch
/// and an opened page share one request.
@MainActor
@Observable
final class CatalogIndexStore {
    private(set) var index: CatalogBrowseIndex?
    private(set) var listedDecks: [CatalogListedDeck]
    /// Every base language code in the index, sorted by its name in the current locale.
    private(set) var languageCodes: [String]
    private(set) var isRefreshing: Bool
    /// The last failed cache read or refresh; cleared by the next successful refresh.
    private(set) var failureMessage: String?

    private let urlSession: URLSession
    private var hasLoadedCache: Bool
    private var indexSha256: String?
    private var lastCheckedAt: Date?
    private var deckPreviewLoads: [String: Task<CatalogDeckPreview, Error>]

    init(urlSession: URLSession) {
        self.index = nil
        self.listedDecks = []
        self.languageCodes = []
        self.isRefreshing = false
        self.failureMessage = nil
        self.urlSession = urlSession
        self.hasLoadedCache = false
        self.indexSha256 = nil
        self.lastCheckedAt = nil
        self.deckPreviewLoads = [:]
    }

    func loadCachedIndexIfNeeded() {
        guard self.hasLoadedCache == false else {
            return
        }
        self.hasLoadedCache = true

        do {
            let fileURL = try catalogBrowseIndexCacheFileURL()
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                return
            }

            let data = try Data(contentsOf: fileURL)
            self.publish(index: try decodeCatalogBrowseIndex(data: data), sha256: catalogBrowseIndexSha256(data: data))
        } catch {
            self.failureMessage = errorMessage(error: error)
        }
    }

    func revalidateIfStale(apiBaseUrl: String, now: Date) async {
        if let lastCheckedAt = self.lastCheckedAt,
           now.timeIntervalSince(lastCheckedAt) < catalogBrowseIndexRevalidationInterval {
            return
        }

        await self.revalidate(apiBaseUrl: apiBaseUrl)
    }

    /// A changed digest only means the index was rebuilt; the body carries `generatedAt`, so it
    /// changes on every catalog refresh.
    func revalidate(apiBaseUrl: String) async {
        guard self.isRefreshing == false else {
            return
        }
        self.isRefreshing = true
        defer {
            self.isRefreshing = false
        }

        do {
            let pointer = try await loadCatalogBrowseIndexPointer(urlSession: self.urlSession, apiBaseUrl: apiBaseUrl)
            if pointer.sha256 != self.indexSha256 {
                let data = try await loadCatalogBrowseIndexData(urlSession: self.urlSession, pointer: pointer)
                let index = try decodeCatalogBrowseIndex(data: data)
                try data.write(to: try catalogBrowseIndexCacheFileURL(), options: .atomic)
                self.publish(index: index, sha256: pointer.sha256)
            }
            self.lastCheckedAt = Date()
            self.failureMessage = nil
        } catch {
            if isRequestCancellationError(error: error) {
                return
            }
            self.failureMessage = errorMessage(error: error)
        }
    }

    private func publish(index: CatalogBrowseIndex, sha256: String) {
        let listedDecks = makeCatalogListedDecks(decks: index.decks)
        self.index = index
        self.listedDecks = listedDecks
        self.languageCodes = sortedCatalogLanguageCodes(
            codes: catalogLanguageCodes(listedDecks: listedDecks),
            locale: Locale.current
        )
        self.indexSha256 = sha256
    }

    /// The cached preview of this deck version, else both requests at once. A package whose latest
    /// version is not the indexed one means the index is stale: the preview is shown uncached and
    /// the index revalidated. The cache only saves requests, so its failures are logged and
    /// the network answers instead.
    func loadDeckPreview(apiBaseUrl: String, deck: CatalogBrowseIndexDeck) async throws -> CatalogDeckPreview {
        if let cachedPreview = loadCachedDeckPreview(packageVersionId: deck.packageVersionId) {
            return cachedPreview
        }
        if let activeLoad = self.deckPreviewLoads[deck.packageVersionId] {
            return try await activeLoad.value
        }

        let urlSession = self.urlSession
        let load = Task<CatalogDeckPreview, Error> { @MainActor in
            async let package = loadCatalogPackageDetail(urlSession: urlSession, apiBaseUrl: apiBaseUrl, slug: deck.slug)
            async let cards = loadCatalogPackageCardPreview(
                urlSession: urlSession,
                apiBaseUrl: apiBaseUrl,
                packageVersionId: deck.packageVersionId
            )
            return CatalogDeckPreview(package: try await package, cards: try await cards)
        }
        self.deckPreviewLoads[deck.packageVersionId] = load
        defer {
            self.deckPreviewLoads[deck.packageVersionId] = nil
        }

        let preview = try await load.value
        if preview.package.latestVersion.packageVersionId == deck.packageVersionId {
            do {
                try saveCachedCatalogDeckPreview(packageVersionId: deck.packageVersionId, preview: preview)
            } catch {
                catalogIndexStoreLogger.error(
                    "catalog_deck_preview_cache_write_failed packageVersionId=\(deck.packageVersionId, privacy: .public) error=\(errorMessage(error: error), privacy: .public)"
                )
            }
        } else {
            Task { @MainActor in
                await self.revalidate(apiBaseUrl: apiBaseUrl)
            }
        }
        return preview
    }

    /// An unreadable entry is deleted, so the next save replaces it.
    private func loadCachedDeckPreview(packageVersionId: String) -> CatalogDeckPreview? {
        do {
            return try loadCachedCatalogDeckPreview(packageVersionId: packageVersionId)
        } catch {
            catalogIndexStoreLogger.error(
                "catalog_deck_preview_cache_read_failed packageVersionId=\(packageVersionId, privacy: .public) error=\(errorMessage(error: error), privacy: .public)"
            )
        }

        do {
            try deleteCachedCatalogDeckPreview(packageVersionId: packageVersionId)
        } catch {
            catalogIndexStoreLogger.error(
                "catalog_deck_preview_cache_delete_failed packageVersionId=\(packageVersionId, privacy: .public) error=\(errorMessage(error: error), privacy: .public)"
            )
        }
        return nil
    }

    /// Warms the first visible deck pages; a failure only matters once the page opens, so it is
    /// logged here and reported there.
    func prefetchDeckPreviews(apiBaseUrl: String, decks: [CatalogBrowseIndexDeck]) async {
        for deck in decks.prefix(catalogDeckPreviewPrefetchCount) {
            if Task.isCancelled {
                return
            }
            do {
                _ = try await self.loadDeckPreview(apiBaseUrl: apiBaseUrl, deck: deck)
            } catch {
                if isRequestCancellationError(error: error) {
                    return
                }
                catalogIndexStoreLogger.warning(
                    "catalog_deck_preview_prefetch_failed packageVersionId=\(deck.packageVersionId, privacy: .public) error=\(errorMessage(error: error), privacy: .public)"
                )
            }
        }
    }
}

private func catalogBrowseIndexCacheFileURL() throws -> URL {
    try FileManager.default.url(
        for: .cachesDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    ).appendingPathComponent(catalogBrowseIndexCacheFileName, isDirectory: false)
}
