import Foundation

private struct CloudSocialAttemptRequest: Encodable {
    let provider: CloudAuthProvider
    let client: CloudAuthClient
    let purpose = "login"
    let codeChallenge: String
}

private struct CloudSocialProofRequest: Encodable {
    let action = "provider"
    let purpose = "login"
    let client: CloudAuthClient
    let codeVerifier: String
    let attempt: String
    let provider: CloudAuthProvider
    let identityToken: String
    let authorizationCode: String?
}

private struct CloudSocialMailboxSendRequest: Encodable {
    let action = "mailbox_send"
    let purpose = "login"
    let client: CloudAuthClient
    let codeVerifier: String
    let attempt: String
    let email: String
}

private struct CloudSocialMailboxVerifyRequest: Encodable {
    let action = "mailbox_verify"
    let purpose = "login"
    let client: CloudAuthClient
    let codeVerifier: String
    let attempt: String
    let code: String
}

private struct CloudSocialRedeemRequest: Encodable {
    let action = "redeem"
    let purpose = "login"
    let client: CloudAuthClient
    let codeVerifier: String
    let completion: String
}

private struct CloudSocialMailboxSentResponse: Decodable {
    let status: String
}

@MainActor
final class CloudSocialAuthService {
    private let session: URLSession
    private let decoder = makeFlashcardsRemoteJSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession) {
        self.session = session
    }

    func metadata(client: CloudAuthClient, authBaseUrl: String) async throws -> CloudAuthMethods {
        let methods: CloudAuthMethods = try await self.request(authBaseUrl: authBaseUrl,
            path: "/api/auth-methods?client=\(client.rawValue)", method: "GET", body: nil)
        try methods.validate(client: client)
        return methods
    }

    func beginLogin(provider: CloudAuthProvider, methods: CloudAuthMethods, authBaseUrl: String) async throws -> CloudSocialLoginAttempt {
        try methods.validate(client: methods.client)
        let availability = provider == .apple ? methods.methods.apple : methods.methods.google
        guard case .native = availability else {
            throw CloudAuthError.invalidResponseBody("Native \(provider.rawValue) sign-in is unavailable")
        }
        let binding = try CloudAuthAttemptBinding.generate(client: methods.client)
        let response: CloudSocialAttemptResponse = try await self.request(authBaseUrl: authBaseUrl,
            path: "/api/social/attempt", method: "POST", body: try self.encoder.encode(CloudSocialAttemptRequest(
                provider: provider, client: binding.client, codeChallenge: binding.codeChallenge)))
        // Apple supplies the provider-ready hash; Google supplies the raw nonce.
        let noncePattern = provider == .apple ? "^[a-f0-9]{64}$" : "^[A-Za-z0-9_-]{43}$"
        try requireCloudSocialContract(response.nonce.utf8.count == (provider == .apple ? 64 : 43)
            && response.nonce.range(of: noncePattern, options: .regularExpression) != nil,
            "Invalid \(provider.rawValue) sign-in nonce")
        return CloudSocialLoginAttempt(provider: provider, binding: binding, authBaseUrl: authBaseUrl, response: response)
    }

    func submitProof(login: CloudSocialLoginAttempt, proof: CloudSocialProviderProof) async throws -> CloudSocialContinuation {
        let provider: CloudAuthProvider
        let identityToken: String
        let authorizationCode: String?
        switch proof {
        case .apple(let token, let code):
            provider = .apple
            identityToken = token
            authorizationCode = code
            try requireCloudSocialContract(!code.isEmpty && code.count <= 4_096, "Apple authorization code is required")
        case .google(let token):
            provider = .google
            identityToken = token
            authorizationCode = nil
        }
        try requireCloudSocialContract(provider == login.provider && !identityToken.isEmpty && identityToken.count <= 16_384,
            "Provider proof does not match the original login attempt")
        let response: CloudSocialContinuationResponse = try await self.request(authBaseUrl: login.authBaseUrl,
            path: "/api/social/complete", method: "POST", body: try self.encoder.encode(CloudSocialProofRequest(
                client: login.binding.client, codeVerifier: login.binding.codeVerifier, attempt: login.response.attempt,
                provider: provider, identityToken: identityToken, authorizationCode: authorizationCode)))
        return response.continuation(login: login)
    }

    func sendMailboxCode(challenge: CloudSocialMailboxChallenge, email: String) async throws {
        let login = challenge.login
        let response: CloudSocialMailboxSentResponse = try await self.request(authBaseUrl: login.authBaseUrl,
            path: "/api/social/complete", method: "POST", body: try self.encoder.encode(CloudSocialMailboxSendRequest(
                client: login.binding.client, codeVerifier: login.binding.codeVerifier, attempt: login.response.attempt, email: email)))
        try requireCloudSocialContract(response.status == "mailbox_code_sent", "Mailbox code was not accepted")
    }

    func verifyMailboxCode(challenge: CloudSocialMailboxChallenge, code: String) async throws -> CloudSocialCompletion {
        let login = challenge.login
        let response: CloudSocialContinuationResponse = try await self.request(authBaseUrl: login.authBaseUrl,
            path: "/api/social/complete", method: "POST", body: try self.encoder.encode(CloudSocialMailboxVerifyRequest(
                client: login.binding.client, codeVerifier: login.binding.codeVerifier, attempt: login.response.attempt, code: code)))
        guard case .completed(let completion) = response.continuation(login: login) else {
            throw CloudAuthError.invalidResponseBody("Mailbox verification did not complete the login attempt")
        }
        return completion
    }

    func redeem(completion: CloudSocialCompletion) async throws -> CloudSocialSession {
        let login = completion.login
        let response: CloudSocialTokenResponse = try await self.request(authBaseUrl: login.authBaseUrl,
            path: "/api/social/complete", method: "POST", body: try self.encoder.encode(CloudSocialRedeemRequest(
                client: login.binding.client, codeVerifier: login.binding.codeVerifier, completion: completion.completion)))
        return try response.session(provider: login.provider, now: Date())
    }

    private func request<Response: Decodable>(authBaseUrl: String, path: String, method: String, body: Data?) async throws -> Response {
        let base = authBaseUrl.hasSuffix("/") ? String(authBaseUrl.dropLast()) : authBaseUrl
        guard let components = URLComponents(string: base),
              components.scheme == "https", components.host?.isEmpty == false,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              let url = URL(string: "\(base)\(path)") else {
            throw CloudAuthError.invalidBaseUrl(authBaseUrl)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CloudAuthError.invalidResponseBody("Native login did not receive an HTTP response")
        }
        let requestId = http.value(forHTTPHeaderField: "X-Request-Id")
        guard (200..<300).contains(http.statusCode) else {
            throw CloudAuthError.invalidResponse(decodeCloudApiErrorDetails(data: data, requestId: requestId,
                retryAfterDelayNanoseconds: cloudRetryAfterDelayNanoseconds(value: http.value(forHTTPHeaderField: "Retry-After"))),
                http.statusCode)
        }
        do {
            return try self.decoder.decode(Response.self, from: data)
        } catch {
            throw CloudAuthError.invalidResponse(CloudApiErrorDetails(
                message: "Native login response failed the \(Response.self) contract", requestId: requestId,
                code: "RESPONSE_CONTRACT_FAILED", syncConflict: nil), http.statusCode)
        }
    }
}
