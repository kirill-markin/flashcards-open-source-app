import Foundation
import Observation

private let catalogBrowseIndexCacheFileName: String = "catalog-browse-index.json"
private let catalogBrowseIndexRevalidationInterval: TimeInterval = 5 * 60

/// App-owned public catalog index: the cached copy is shown at once, then revalidated against
/// the pointer. The cache file holds the index JSON exactly as downloaded, so its SHA-256 is
/// the pointer digest it was verified against.
@MainActor
@Observable
final class CatalogIndexStore {
    private(set) var index: CatalogBrowseIndex?
    private(set) var isRefreshing: Bool
    /// The last failed cache read or refresh; cleared by the next successful refresh.
    private(set) var failureMessage: String?

    private let urlSession: URLSession
    private var hasLoadedCache: Bool
    private var indexSha256: String?
    private var lastCheckedAt: Date?

    init(urlSession: URLSession) {
        self.index = nil
        self.isRefreshing = false
        self.failureMessage = nil
        self.urlSession = urlSession
        self.hasLoadedCache = false
        self.indexSha256 = nil
        self.lastCheckedAt = nil
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
            self.index = try decodeCatalogBrowseIndex(data: data)
            self.indexSha256 = catalogBrowseIndexSha256(data: data)
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
                self.index = index
                self.indexSha256 = pointer.sha256
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
}

private func catalogBrowseIndexCacheFileURL() throws -> URL {
    try FileManager.default.url(
        for: .cachesDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    ).appendingPathComponent(catalogBrowseIndexCacheFileName, isDirectory: false)
}
