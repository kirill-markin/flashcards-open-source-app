import Foundation

let catalogDeckPreviewCardLimit: Int = 10

/// Bumped with any change to `CatalogDeckPreview`, so an app update never reads an older shape.
private let catalogDeckPreviewCacheDirectoryName: String = "catalog-deck-previews-v1"
private let catalogDeckPreviewCacheMaxEntries: Int = 50

/// Not-found answers of the public catalog and install routes; a 409 not-published also means the
/// version left the catalog.
private let catalogDeckUnavailableErrorCodes: Set<String> = [
    "CATALOG_PUBLIC_PACKAGE_NOT_FOUND",
    "CATALOG_PUBLIC_PACKAGE_VERSION_NOT_FOUND",
    "CATALOG_PACKAGE_VERSION_NOT_FOUND",
    "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED",
]

/// A deck page's network content. Package versions never change, so it is cached on disk by
/// package version id.
struct CatalogDeckPreview: Codable, Hashable, Sendable {
    let package: CatalogPackageDetail
    let cards: [CatalogPackageCardPreview]
}

/// `GET /catalog/packages/{slug}`: the package as of its latest published version.
struct CatalogPackageDetail: Codable, Hashable, Sendable {
    let description: String
    let latestVersion: CatalogPackageLatestVersion
    let mediaAssets: [CatalogPackageMediaAsset]
}

struct CatalogPackageLatestVersion: Codable, Hashable, Sendable {
    let packageVersionId: String
}

struct CatalogPackageMediaAsset: Codable, Hashable, Sendable {
    let packageMediaKey: String
    /// Null for an asset the public catalog never published.
    let downloadUrl: String?
}

struct CatalogPackageCardPreview: Codable, Hashable, Sendable {
    let ordinal: Int
    let frontText: String
    let backText: String
}

private struct CatalogPackageDetailEnvelope: Decodable {
    let catalogPackage: CatalogPackageDetail
}

private struct CatalogPackageCardPreviewEnvelope: Decodable {
    let packageVersionId: String
    let cards: [CatalogPackageCardPreview]
}

enum CatalogDeckPreviewError: LocalizedError {
    case invalidUrl(apiBaseUrl: String, path: String)
    case cardsForAnotherVersion(requested: String, returned: String)

    var errorDescription: String? {
        switch self {
        case .invalidUrl(let apiBaseUrl, let path):
            return "Catalog deck URL could not be built from API base URL \(apiBaseUrl) and path \(path)."
        case .cardsForAnotherVersion(let requested, let returned):
            return "Catalog card preview for package version \(requested) returned cards of version \(returned)."
        }
    }
}

func loadCatalogPackageDetail(urlSession: URLSession, apiBaseUrl: String, slug: String) async throws -> CatalogPackageDetail {
    guard let encodedSlug = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) else {
        throw CatalogDeckPreviewError.invalidUrl(apiBaseUrl: apiBaseUrl, path: "/catalog/packages/\(slug)")
    }

    let url = try catalogApiUrl(apiBaseUrl: apiBaseUrl, path: "/catalog/packages/\(encodedSlug)")
    let data = try await loadCatalogData(urlSession: urlSession, url: url)
    return try makeFlashcardsRemoteJSONDecoder().decode(CatalogPackageDetailEnvelope.self, from: data).catalogPackage
}

func loadCatalogPackageCardPreview(
    urlSession: URLSession,
    apiBaseUrl: String,
    packageVersionId: String
) async throws -> [CatalogPackageCardPreview] {
    let url = try catalogApiUrl(
        apiBaseUrl: apiBaseUrl,
        path: "/catalog/package-versions/\(packageVersionId)/cards?limit=\(catalogDeckPreviewCardLimit)"
    )
    let data = try await loadCatalogData(urlSession: urlSession, url: url)
    let envelope = try makeFlashcardsRemoteJSONDecoder().decode(CatalogPackageCardPreviewEnvelope.self, from: data)
    guard envelope.packageVersionId == packageVersionId else {
        throw CatalogDeckPreviewError.cardsForAnotherVersion(requested: packageVersionId, returned: envelope.packageVersionId)
    }

    return envelope.cards
}

private func catalogApiUrl(apiBaseUrl: String, path: String) throws -> URL {
    let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
    guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
        throw CatalogDeckPreviewError.invalidUrl(apiBaseUrl: apiBaseUrl, path: path)
    }

    return url
}

/// Nil when this version has no cached preview.
func loadCachedCatalogDeckPreview(packageVersionId: String) throws -> CatalogDeckPreview? {
    let fileURL = try catalogDeckPreviewCacheFileURL(packageVersionId: packageVersionId)
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        return nil
    }

    return try JSONDecoder().decode(CatalogDeckPreview.self, from: Data(contentsOf: fileURL))
}

/// Writes the preview, then drops the oldest-written entries beyond the cache limit.
func saveCachedCatalogDeckPreview(packageVersionId: String, preview: CatalogDeckPreview) throws {
    try JSONEncoder().encode(preview).write(
        to: try catalogDeckPreviewCacheFileURL(packageVersionId: packageVersionId),
        options: .atomic
    )

    let fileManager = FileManager.default
    let entries = try fileManager.contentsOfDirectory(
        at: try catalogDeckPreviewCacheDirectoryURL(),
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
    )
    guard entries.count > catalogDeckPreviewCacheMaxEntries else {
        return
    }

    let entriesByAge = try entries.map { entry in
        (url: entry, modifiedAt: try entry.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast)
    }.sorted { left, right in
        left.modifiedAt < right.modifiedAt
    }
    for entry in entriesByAge.prefix(entries.count - catalogDeckPreviewCacheMaxEntries) {
        try fileManager.removeItem(at: entry.url)
    }
}

private func catalogDeckPreviewCacheDirectoryURL() throws -> URL {
    let directoryURL = try FileManager.default.url(
        for: .cachesDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    ).appendingPathComponent(catalogDeckPreviewCacheDirectoryName, isDirectory: true)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    return directoryURL
}

private func catalogDeckPreviewCacheFileURL(packageVersionId: String) throws -> URL {
    try catalogDeckPreviewCacheDirectoryURL().appendingPathComponent("\(packageVersionId).json", isDirectory: false)
}

/// Points catalog `fcasset:<packageMediaKey>` references at their published CDN objects, so the
/// card renderer shows them as linked images; a key without a published object stays as it is.
func catalogPreviewMarkdown(text: String, mediaAssets: [CatalogPackageMediaAsset]) -> String {
    let downloadUrlsByKey: [String: String] = Dictionary(
        mediaAssets.compactMap { asset in
            asset.downloadUrl.map { (asset.packageMediaKey, $0) }
        },
        uniquingKeysWith: { first, _ in first }
    )
    guard downloadUrlsByKey.isEmpty == false else {
        return text
    }

    let nsText = text as NSString
    let result = NSMutableString(string: text)
    let matches = catalogPreviewMediaReferenceExpression.matches(in: text, range: NSRange(location: 0, length: nsText.length))
    for match in matches.reversed() {
        let key = nsText.substring(with: match.range(at: 1))
        if let downloadUrl = downloadUrlsByKey[key] {
            result.replaceCharacters(in: match.range, with: downloadUrl)
        }
    }
    return result as String
}

private let catalogPreviewMediaReferenceExpression = makeReviewContentRegularExpression(
    pattern: #"fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)"#
)

func isCatalogDeckUnavailableError(error: Error) -> Bool {
    switch technicalErrorPresentationSource(error: error) {
    case CatalogBrowseIndexError.responseNotOk(_, let statusCode, let code, _, _):
        return isCatalogDeckUnavailableResponse(statusCode: statusCode, code: code)
    case CloudSyncError.invalidResponse(let details, let statusCode):
        return isCatalogDeckUnavailableResponse(statusCode: statusCode, code: details.code)
    default:
        return false
    }
}

/// A 404 with another error code is a different missing resource, such as the workspace.
private func isCatalogDeckUnavailableResponse(statusCode: Int, code: String?) -> Bool {
    if let code {
        return catalogDeckUnavailableErrorCodes.contains(code) || statusCode == 410
    }

    return statusCode == 404 || statusCode == 410
}
