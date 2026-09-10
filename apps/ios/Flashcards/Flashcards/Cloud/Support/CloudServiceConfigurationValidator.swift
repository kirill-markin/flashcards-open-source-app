import Foundation

private let supportedCloudContractVersion: Int = 1
private let expectedCloudAPIService: String = "flashcards-open-source-app-backend"

private struct CloudAPIHealthResponse: Decodable {
    let service: String
    let cloudContractVersion: Int
}

private struct CloudServiceOrigin: Equatable {
    let scheme: String
    let host: String
    let effectivePort: Int?

    init?(url: URL) {
        guard let scheme = url.scheme?.lowercased(),
            let host = url.host?.lowercased() else {
            return nil
        }

        self.scheme = scheme
        self.host = host
        self.effectivePort = url.port ?? Self.defaultPort(scheme: scheme)
    }

    private static func defaultPort(scheme: String) -> Int? {
        switch scheme {
        case "http":
            return 80
        case "https":
            return 443
        default:
            return nil
        }
    }
}

enum CloudServiceConfigurationValidationError: LocalizedError, Equatable {
    case invalidHealthUrl(String)
    case requestFailed(String, String, String)
    case invalidStatusCode(String, String, Int)
    case redirectedToDifferentOrigin(String, String, String)
    case invalidAPIHealthResponse(String)
    case unexpectedAPIService(String, String)
    case unsupportedCloudContractVersion(String, Int)

    var errorDescription: String? {
        switch self {
        case .invalidHealthUrl(let url):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.invalidHealthUrl",
                "Health check URL is invalid: %@",
                url
            )
        case .requestFailed(let serviceName, let url, let message):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.requestFailed",
                "%@ health check failed for %@: %@",
                serviceName,
                url,
                message
            )
        case .invalidStatusCode(let serviceName, let url, let statusCode):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.invalidStatusCode",
                "%@ health check returned status %d for %@",
                serviceName,
                statusCode,
                url
            )
        case .redirectedToDifferentOrigin(let serviceName, let url, let finalUrl):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.redirectedToDifferentOrigin",
                "%@ health check for %@ was redirected to another server: %@. Configure it to respond on the same server, then try again.",
                serviceName,
                url,
                finalUrl
            )
        case .invalidAPIHealthResponse(let url):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.invalidApiHealthResponse",
                "API health at %@ does not advertise a valid service and cloud contract. Update and redeploy the custom server, then try again.",
                url
            )
        case .unexpectedAPIService(let url, let actualService):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.unexpectedApiService",
                "API health at %@ identifies %@ instead of a compatible Flashcards backend. Update and redeploy the custom server, then try again.",
                url,
                actualService
            )
        case .unsupportedCloudContractVersion(let url, let actualVersion):
            return aiSettingsLocalizedFormat(
                "settings.account.server.validation.unsupportedCloudContractVersion",
                "API health at %@ advertises unsupported cloud contract version %d. This app requires version 1. Update and redeploy the custom server, then try again.",
                url,
                actualVersion
            )
        }
    }
}

@MainActor
final class CloudServiceConfigurationValidator {
    private let session: URLSession

    init(session: URLSession) {
        self.session = session
    }

    convenience init() {
        self.init(session: URLSession.shared)
    }

    func validate(configuration: CloudServiceConfiguration) async throws {
        _ = try await self.validateHealthEndpoint(
            serviceName: aiSettingsLocalized("settings.account.server.validation.authService", "Auth service"),
            baseUrl: configuration.authBaseUrl
        )
        let apiHealth = try await self.validateHealthEndpoint(
            serviceName: aiSettingsLocalized("settings.account.server.validation.apiService", "API service"),
            baseUrl: configuration.apiBaseUrl
        )
        try self.validateAPIHealthResponse(data: apiHealth.data, url: apiHealth.url)
    }

    private func validateHealthEndpoint(serviceName: String, baseUrl: String) async throws -> (data: Data, url: String) {
        let normalizedBaseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        guard let url = URL(string: "\(normalizedBaseUrl)/health") else {
            throw CloudServiceConfigurationValidationError.invalidHealthUrl("\(normalizedBaseUrl)/health")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        do {
            let (data, response) = try await self.session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw CloudServiceConfigurationValidationError.requestFailed(
                    serviceName,
                    url.absoluteString,
                    "Expected an HTTP response"
                )
            }

            guard let finalUrl = httpResponse.url,
                let requestedOrigin = CloudServiceOrigin(url: url),
                let finalOrigin = CloudServiceOrigin(url: finalUrl),
                requestedOrigin == finalOrigin else {
                throw CloudServiceConfigurationValidationError.redirectedToDifferentOrigin(
                    serviceName,
                    url.absoluteString,
                    httpResponse.url?.absoluteString ?? "unknown"
                )
            }

            guard 200..<300 ~= httpResponse.statusCode else {
                throw CloudServiceConfigurationValidationError.invalidStatusCode(
                    serviceName,
                    url.absoluteString,
                    httpResponse.statusCode
                )
            }
            return (data, finalUrl.absoluteString)
        } catch let validationError as CloudServiceConfigurationValidationError {
            throw validationError
        } catch {
            throw CloudServiceConfigurationValidationError.requestFailed(
                serviceName,
                url.absoluteString,
                Flashcards.errorMessage(error: error)
            )
        }
    }

    private func validateAPIHealthResponse(data: Data, url: String) throws {
        guard let healthResponse = try? JSONDecoder().decode(CloudAPIHealthResponse.self, from: data) else {
            throw CloudServiceConfigurationValidationError.invalidAPIHealthResponse(url)
        }
        guard healthResponse.service == expectedCloudAPIService else {
            throw CloudServiceConfigurationValidationError.unexpectedAPIService(
                url,
                healthResponse.service
            )
        }
        guard healthResponse.cloudContractVersion == supportedCloudContractVersion else {
            throw CloudServiceConfigurationValidationError.unsupportedCloudContractVersion(
                url,
                healthResponse.cloudContractVersion
            )
        }
    }
}
