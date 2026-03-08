import Foundation

enum CloudAuthError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(Int, String)
    case invalidResponseBody(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl(let value):
            return "Cloud auth base URL is invalid: \(value)"
        case .invalidResponse(let statusCode, let message):
            return "Cloud auth request failed with status \(statusCode): \(message)"
        case .invalidResponseBody(let message):
            return "Cloud auth response is invalid: \(message)"
        }
    }

    var statusCode: Int? {
        switch self {
        case .invalidResponse(let statusCode, _):
            return statusCode
        case .invalidBaseUrl, .invalidResponseBody:
            return nil
        }
    }
}

private struct SendCodeRequest: Encodable {
    let email: String
}

private struct SendCodeResponse: Decodable {
    let ok: Bool
    let csrfToken: String?
}

private struct VerifyCodeRequest: Encodable {
    let code: String
    let csrfToken: String
}

private struct VerifyCodeResponse: Decodable {
    let ok: Bool
    let idToken: String
    let refreshToken: String
    let expiresIn: Int
}

private struct RefreshTokenRequest: Encodable {
    let refreshToken: String
}

private struct RefreshTokenResponse: Decodable {
    let ok: Bool
    let idToken: String
    let expiresIn: Int
}

@MainActor
final class CloudAuthService {
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        session: URLSession? = nil,
        cookieStorage: HTTPCookieStorage = HTTPCookieStorage()
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.cookieStorage = cookieStorage

        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = true
            configuration.httpCookieAcceptPolicy = .always
            configuration.httpCookieStorage = cookieStorage
            self.session = URLSession(configuration: configuration)
        }
    }

    func sendCode(email: String, authBaseUrl: String) async throws -> CloudOtpChallenge {
        self.resetChallengeSession()

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let response: SendCodeResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/send-code",
            method: "POST",
            body: SendCodeRequest(email: normalizedEmail)
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("send-code did not return ok=true")
        }
        guard let csrfToken = response.csrfToken, csrfToken.isEmpty == false else {
            throw CloudAuthError.invalidResponseBody("send-code did not return csrfToken")
        }

        return CloudOtpChallenge(email: normalizedEmail, csrfToken: csrfToken)
    }

    func verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String) async throws -> StoredCloudCredentials {
        let normalizedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let response: VerifyCodeResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/verify-code",
            method: "POST",
            body: VerifyCodeRequest(
                code: normalizedCode,
                csrfToken: challenge.csrfToken
            )
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("verify-code did not return ok=true")
        }

        return StoredCloudCredentials(
            refreshToken: response.refreshToken,
            idToken: response.idToken,
            idTokenExpiresAt: makeIdTokenExpiryTimestamp(now: Date(), expiresInSeconds: response.expiresIn)
        )
    }

    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken {
        let response: RefreshTokenResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/refresh-token",
            method: "POST",
            body: RefreshTokenRequest(refreshToken: refreshToken)
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("refresh-token did not return ok=true")
        }

        return CloudIdentityToken(
            idToken: response.idToken,
            idTokenExpiresAt: makeIdTokenExpiryTimestamp(now: Date(), expiresInSeconds: response.expiresIn)
        )
    }

    func resetChallengeSession() {
        if let cookies = self.cookieStorage.cookies {
            for cookie in cookies {
                self.cookieStorage.deleteCookie(cookie)
            }
        }
    }

    private func makeUrl(authBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = authBaseUrl.hasSuffix("/") ? String(authBaseUrl.dropLast()) : authBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudAuthError.invalidBaseUrl(authBaseUrl)
        }

        return url
    }

    private func request<Response: Decodable, Body: Encodable>(
        authBaseUrl: String,
        path: String,
        method: String,
        body: Body
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(authBaseUrl: authBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.encoder.encode(body)

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud auth did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            throw CloudAuthError.invalidResponse(
                httpResponse.statusCode,
                parseCloudHttpErrorMessage(data: data, fallback: "<non-utf8-body>")
            )
        }

        return try self.decoder.decode(Response.self, from: data)
    }
}

private func parseCloudHttpErrorMessage(data: Data, fallback: String) -> String {
    if
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let message = object["error"] as? String,
        message.isEmpty == false
    {
        return message
    }

    return String(data: data, encoding: .utf8) ?? fallback
}
