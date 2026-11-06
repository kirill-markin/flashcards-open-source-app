import CryptoKit
import Foundation
import OSLog

/// The schema this client reads; the backend owns it in `catalogBrowseIndexSchemaVersion`.
let supportedCatalogBrowseIndexSchemaVersion: Int = 1

private let catalogBrowseIndexMaxAttempts: Int = 3

private let catalogBrowseIndexLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "catalog_browse_index"
)

/// `GET /catalog/browse-index`: where the current index object lives and the digest of its JSON.
struct CatalogBrowseIndexPointer: Decodable, Hashable, Sendable {
    let url: String
    let sha256: String
    let generatedAt: String
}

struct CatalogBrowseIndex: Decodable, Hashable, Sendable {
    let schemaVersion: Int
    let generatedAt: String
    let decks: [CatalogBrowseIndexDeck]
}

struct CatalogBrowseIndexDeck: Decodable, Hashable, Identifiable, Sendable {
    let packageId: String
    let packageVersionId: String
    let slug: String
    let title: String
    let summary: String
    let languageTags: [String]
    let educationalSubject: String
    let cardCount: Int
    let publishedAt: Date
    let authorDisplayName: String
    let coverImageUrl: URL?
    let reviewTag: String

    var id: String {
        self.packageId
    }

    private enum CodingKeys: String, CodingKey {
        case packageId
        case packageVersionId
        case slug
        case title
        case summary
        case languageTags
        case educationalSubject
        case cardCount
        case publishedAt
        case authorDisplayName
        case coverImageUrl
        case reviewTag
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.packageId = try container.decode(String.self, forKey: .packageId)
        self.packageVersionId = try container.decode(String.self, forKey: .packageVersionId)
        self.slug = try container.decode(String.self, forKey: .slug)
        self.title = try container.decode(String.self, forKey: .title)
        self.summary = try container.decode(String.self, forKey: .summary)
        self.languageTags = try container.decode([String].self, forKey: .languageTags)
        self.educationalSubject = try container.decode(String.self, forKey: .educationalSubject)
        self.cardCount = try container.decode(Int.self, forKey: .cardCount)
        let publishedAt = try container.decode(String.self, forKey: .publishedAt)
        guard let publishedAtDate = parseStrictIsoTimestamp(value: publishedAt) else {
            throw DecodingError.dataCorruptedError(
                forKey: .publishedAt,
                in: container,
                debugDescription: "Catalog deck \(self.packageId) has an invalid publishedAt timestamp: \(publishedAt)"
            )
        }
        self.publishedAt = publishedAtDate
        self.authorDisplayName = try container.decode(String.self, forKey: .authorDisplayName)
        // Present on every deck, null when the deck has no cover.
        if try container.decodeNil(forKey: .coverImageUrl) {
            self.coverImageUrl = nil
        } else {
            let coverImageUrl = try container.decode(String.self, forKey: .coverImageUrl)
            guard let url = URL(string: coverImageUrl) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .coverImageUrl,
                    in: container,
                    debugDescription: "Catalog deck \(self.packageId) has an invalid coverImageUrl: \(coverImageUrl)"
                )
            }
            self.coverImageUrl = url
        }
        self.reviewTag = try container.decode(String.self, forKey: .reviewTag)
    }
}

private struct CatalogBrowseIndexSchemaHeader: Decodable {
    let schemaVersion: Int
}

enum CatalogBrowseIndexError: LocalizedError, Equatable {
    case invalidPointerUrl(apiBaseUrl: String)
    case invalidIndexUrl(url: String)
    case invalidHttpResponse(url: String)
    case responseNotOk(url: String, statusCode: Int, code: String?, message: String, requestId: String?)
    case sha256Mismatch(url: String, expected: String, actual: String)
    case unsupportedSchemaVersion(schemaVersion: Int)

    var errorDescription: String? {
        switch self {
        case .invalidPointerUrl(let apiBaseUrl):
            return "Catalog browse index URL could not be built from API base URL: \(apiBaseUrl)"
        case .invalidIndexUrl(let url):
            return "Catalog browse index pointer returned an invalid URL: \(url)"
        case .invalidHttpResponse(let url):
            return "Catalog request to \(url) returned a non-HTTP response."
        case .responseNotOk(let url, let statusCode, let code, let message, let requestId):
            return appendCloudRequestIdReference(
                message: "Catalog request to \(url) failed with status \(statusCode)\(code.map { " (\($0))" } ?? ""): \(message)",
                requestId: requestId
            )
        case .sha256Mismatch(let url, let expected, let actual):
            return "Catalog browse index from \(url) has SHA-256 \(actual), but the pointer announced \(expected)."
        case .unsupportedSchemaVersion(let schemaVersion):
            return "Catalog browse index schema version \(schemaVersion) is not supported; this app reads version \(supportedCatalogBrowseIndexSchemaVersion). Update the app to browse the catalog."
        }
    }
}

func catalogBrowseIndexSha256(data: Data) -> String {
    SHA256.hash(data: data).map { byte in
        String(format: "%02x", byte)
    }.joined()
}

/// Rejects an unknown schema before decoding, so a new shape reports its version instead of a missing field.
func decodeCatalogBrowseIndex(data: Data) throws -> CatalogBrowseIndex {
    let decoder = makeFlashcardsRemoteJSONDecoder()
    let header = try decoder.decode(CatalogBrowseIndexSchemaHeader.self, from: data)
    guard header.schemaVersion == supportedCatalogBrowseIndexSchemaVersion else {
        throw CatalogBrowseIndexError.unsupportedSchemaVersion(schemaVersion: header.schemaVersion)
    }

    return try decoder.decode(CatalogBrowseIndex.self, from: data)
}

func loadCatalogBrowseIndexPointer(urlSession: URLSession, apiBaseUrl: String) async throws -> CatalogBrowseIndexPointer {
    let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
    guard let url = URL(string: "\(trimmedBaseUrl)/catalog/browse-index") else {
        throw CatalogBrowseIndexError.invalidPointerUrl(apiBaseUrl: apiBaseUrl)
    }

    let data = try await loadCatalogData(urlSession: urlSession, url: url)
    return try makeFlashcardsRemoteJSONDecoder().decode(CatalogBrowseIndexPointer.self, from: data)
}

/// Returns the index JSON bytes after checking them against the pointer's digest. URLSession
/// decodes the object's `Content-Encoding: gzip` itself, so the digest covers the JSON.
func loadCatalogBrowseIndexData(urlSession: URLSession, pointer: CatalogBrowseIndexPointer) async throws -> Data {
    guard let url = URL(string: pointer.url) else {
        throw CatalogBrowseIndexError.invalidIndexUrl(url: pointer.url)
    }

    let data = try await loadCatalogData(urlSession: urlSession, url: url)
    let actualSha256 = catalogBrowseIndexSha256(data: data)
    guard actualSha256 == pointer.sha256 else {
        throw CatalogBrowseIndexError.sha256Mismatch(url: pointer.url, expected: pointer.sha256, actual: actualSha256)
    }

    return data
}

/// A public GET with no auth header, retried on transport failures and 5xx responses.
func loadCatalogData(urlSession: URLSession, url: URL) async throws -> Data {
    var attempt = 1
    while true {
        do {
            return try await loadCatalogDataOnce(urlSession: urlSession, url: url)
        } catch {
            guard attempt < catalogBrowseIndexMaxAttempts, isRetryableCatalogFailure(error: error) else {
                throw error
            }

            catalogBrowseIndexLogger.warning(
                "catalog_request_retry url=\(url.absoluteString, privacy: .public) attempt=\(attempt, privacy: .public) error=\(errorMessage(error: error), privacy: .public)"
            )
            try await Task.sleep(nanoseconds: UInt64(attempt) * 500_000_000)
            attempt += 1
        }
    }
}

private func loadCatalogDataOnce(urlSession: URLSession, url: URL) async throws -> Data {
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    let (data, response) = try await urlSession.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
        throw CatalogBrowseIndexError.invalidHttpResponse(url: url.absoluteString)
    }

    guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
        let details = decodeCloudApiErrorDetails(
            data: data,
            requestId: httpResponse.value(forHTTPHeaderField: "X-Request-Id")
        )
        throw CatalogBrowseIndexError.responseNotOk(
            url: url.absoluteString,
            statusCode: httpResponse.statusCode,
            code: details.code,
            message: details.message,
            requestId: details.requestId
        )
    }

    return data
}

private func isRetryableCatalogFailure(error: Error) -> Bool {
    if case CatalogBrowseIndexError.responseNotOk(_, let statusCode, _, _, _) = error {
        return statusCode >= 500
    }

    return isRetryableNetworkTransportFailure(error: error)
}
