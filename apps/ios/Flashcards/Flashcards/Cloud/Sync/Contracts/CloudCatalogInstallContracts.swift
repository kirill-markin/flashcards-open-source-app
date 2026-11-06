import Foundation

/// `GET /catalog/package-versions/{id}/install-context`: only the fields the one-tap install reads.
struct CatalogPackageInstallContext: Decodable, Hashable, Sendable {
    let workspaces: [CatalogPackageInstallWorkspaceContext]
}

struct CatalogPackageInstallWorkspaceContext: Decodable, Hashable, Sendable {
    let workspaceId: String
    /// Null when this workspace holds no install of the package, in any version.
    let previousInstall: CatalogPackageInstallPreviousInstall?

    private enum CodingKeys: String, CodingKey {
        case workspaceId
        case previousInstall
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.workspaceId = try container.decode(String.self, forKey: .workspaceId)
        // Present on every workspace, null when the package was never installed there.
        if try container.decodeNil(forKey: .previousInstall) {
            self.previousInstall = nil
        } else {
            self.previousInstall = try container.decode(CatalogPackageInstallPreviousInstall.self, forKey: .previousInstall)
        }
    }
}

struct CatalogPackageInstallPreviousInstall: Decodable, Hashable, Sendable {
    let installId: String
}

struct CatalogPackageInstallRequest: Encodable, Hashable, Sendable {
    let installId: String
    let installedAt: String
    let clientUpdatedAt: String
    let lastModifiedByReplicaId: String
    let operationIdPrefix: String
    let addImportTag: Bool
    let removeTags: [String]
}

struct CatalogPackageInstallResponse: Decodable, Hashable, Sendable {
    let summary: CatalogPackageInstallResponseSummary
}

struct CatalogPackageInstallResponseSummary: Decodable, Hashable, Sendable {
    let installId: String
    let cardCount: Int
}
