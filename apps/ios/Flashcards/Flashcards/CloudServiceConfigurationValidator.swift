import Foundation

enum CloudServiceConfigurationValidationError: LocalizedError, Equatable {
    case invalidHealthUrl(String)
    case requestFailed(String, String, String)
    case invalidStatusCode(String, String, Int)

    var errorDescription: String? {
        switch self {
        case .invalidHealthUrl(let url):
            return "Health check URL is invalid: \(url)"
        case .requestFailed(let serviceName, let url, let message):
            return "\(serviceName) health check failed for \(url): \(message)"
        case .invalidStatusCode(let serviceName, let url, let statusCode):
            return "\(serviceName) health check returned status \(statusCode) for \(url)"
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
        try await self.validateHealthEndpoint(
            serviceName: "Auth service",
            baseUrl: configuration.authBaseUrl
        )
        try await self.validateHealthEndpoint(
            serviceName: "API service",
            baseUrl: configuration.apiBaseUrl
        )
    }

    private func validateHealthEndpoint(serviceName: String, baseUrl: String) async throws {
        let normalizedBaseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        guard let url = URL(string: "\(normalizedBaseUrl)/health") else {
            throw CloudServiceConfigurationValidationError.invalidHealthUrl("\(normalizedBaseUrl)/health")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        do {
            let (_, response) = try await self.session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw CloudServiceConfigurationValidationError.requestFailed(
                    serviceName,
                    url.absoluteString,
                    "Expected an HTTP response"
                )
            }

            guard 200..<300 ~= httpResponse.statusCode else {
                throw CloudServiceConfigurationValidationError.invalidStatusCode(
                    serviceName,
                    url.absoluteString,
                    httpResponse.statusCode
                )
            }
        } catch let validationError as CloudServiceConfigurationValidationError {
            throw validationError
        } catch {
            throw CloudServiceConfigurationValidationError.requestFailed(
                serviceName,
                url.absoluteString,
                localizedMessage(error: error)
            )
        }
    }
}
