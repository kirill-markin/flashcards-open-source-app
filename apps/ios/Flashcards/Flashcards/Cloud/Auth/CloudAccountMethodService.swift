import Foundation

private struct AccountProviderBegin: Encodable {
    let action = "begin"
    let client: CloudAuthClient
    let purpose: CloudAccountProofPurpose
    let codeChallenge: String
    let provider: CloudAuthProvider
    let intent: String?
    let target: CloudAccountProviderTarget?
    let proof: CloudAccountReauthenticationReceipt?
}

private struct AccountProviderComplete: Encodable {
    let action: String
    let purpose: CloudAccountProofPurpose
    let client: CloudAuthClient
    let codeVerifier: String
    let attempt: String
    let provider: CloudAuthProvider?
    let identityToken: String?
    let authorizationCode: String?
    let email: String?
    let code: String?
}

private struct AccountEmailBegin: Encodable {
    let action = "begin"
    let client: CloudAuthClient
    let codeChallenge: String
}

private struct AccountEmailComplete: Encodable {
    let action = "complete"
    let client: CloudAuthClient
    let codeVerifier: String
    let attempt: String
    let code: String
}

private struct AccountLinkComplete: Encodable {
    let action = "complete"
    let purpose = "link"
    let client: CloudAuthClient
    let codeVerifier: String
    let completion: String
}

private struct AccountUnlink: Encodable {
    let client: CloudAuthClient
    let target: CloudAccountProviderTarget
    let proof: CloudAccountReauthenticationReceipt
}

private struct AccountMutationResult: Decodable {
    let ok: Bool
    let purpose: String?
}

private struct AccountMailboxSent: Decodable { let status: String }

@MainActor
final class CloudAccountMethodService {
    private let session: URLSession
    private let decoder = makeFlashcardsRemoteJSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession) { self.session = session }

    func list(authBaseUrl: String, bearer: String) async throws -> CloudAccountLoginMethods {
        try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/account/login-methods?client=\(CloudAuthClient.currentNative.rawValue)", body: nil)
    }

    func beginProvider(provider: CloudAuthProvider, purpose: CloudAccountProofPurpose,
        binding: CloudAuthAttemptBinding, operation: CloudAccountMethodOperation?,
        proof: CloudAccountReauthenticationReceipt?, authBaseUrl: String, bearer: String
    ) async throws -> CloudAccountProviderAttempt {
        let intent: String?
        let target: CloudAccountProviderTarget?
        switch operation {
        case .some(.link): intent = "link"; target = nil
        case .some(.reenable(let value)): intent = "reenable"; target = value
        case .some(.unlink): throw CloudAccountMethodError.invalidPhase
        case .none: intent = nil; target = nil
        }
        let response: CloudSocialAttemptResponse = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/social/attempt", body: self.encoder.encode(AccountProviderBegin(client: binding.client,
                purpose: purpose, codeChallenge: binding.codeChallenge, provider: provider, intent: intent, target: target, proof: proof)))
        let pattern = provider == .apple ? "^[a-f0-9]{64}$" : "^[A-Za-z0-9_-]{43}$"
        try requireCloudSocialContract(response.nonce.range(of: pattern, options: .regularExpression) != nil,
            "Invalid management provider nonce")
        return CloudAccountProviderAttempt(provider: provider, purpose: purpose, binding: binding, response: response)
    }

    func submitProvider(attempt: CloudAccountProviderAttempt, proof: CloudSocialProviderProof,
        operation: CloudAccountMethodOperation?, authBaseUrl: String, bearer: String
    ) async throws -> CloudSocialContinuationResponse? {
        let token: String
        let authorizationCode: String?
        switch proof {
        case .apple(let value, let code):
            try requireCloudSocialContract(attempt.provider == .apple && !code.isEmpty && code.count <= 4_096,
                "Apple management credential does not match its attempt")
            token = value; authorizationCode = code
        case .google(let value):
            try requireCloudSocialContract(attempt.provider == .google, "Google management credential does not match its attempt")
            token = value; authorizationCode = nil
        }
        try requireCloudSocialContract(!token.isEmpty && token.count <= 16_384, "Invalid management provider credential")
        let reenable: Bool
        if case .some(.reenable) = operation { reenable = true } else { reenable = false }
        let body = try self.encoder.encode(AccountProviderComplete(action: reenable ? "reenable_provider" : "provider",
            purpose: attempt.purpose, client: attempt.binding.client, codeVerifier: attempt.binding.codeVerifier,
            attempt: attempt.response.attempt, provider: attempt.provider, identityToken: token,
            authorizationCode: authorizationCode, email: nil, code: nil))
        if reenable {
            let result: AccountMutationResult = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
                path: "/api/social/complete", body: body)
            try self.validateMutation(result, purpose: "link")
            return nil
        }
        return try await self.request(authBaseUrl: authBaseUrl, bearer: bearer, path: "/api/social/complete", body: body)
    }

    func sendMailbox(challenge: CloudAccountMailboxChallenge, email: String, authBaseUrl: String, bearer: String) async throws {
        let result: AccountMailboxSent = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/social/complete", body: self.mailboxBody(attempt: challenge.attempt, action: "mailbox_send", email: email, code: nil))
        try requireCloudSocialContract(result.status == "mailbox_code_sent", "Management mailbox send was not accepted")
    }

    func verifyMailbox(challenge: CloudAccountMailboxChallenge, code: String,
        authBaseUrl: String, bearer: String
    ) async throws -> CloudSocialContinuationResponse {
        try await self.request(authBaseUrl: authBaseUrl, bearer: bearer, path: "/api/social/complete",
            body: self.mailboxBody(attempt: challenge.attempt, action: "mailbox_verify", email: nil, code: code))
    }

    func beginEmail(binding: CloudAuthAttemptBinding, authBaseUrl: String, bearer: String) async throws -> CloudAccountEmailAttempt {
        let result: CloudAccountEmailAttempt = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/account/reauth/email", body: self.encoder.encode(AccountEmailBegin(client: binding.client,
                codeChallenge: binding.codeChallenge)))
        try result.validate()
        return result
    }

    func completeEmail(attempt: CloudAccountEmailAttempt, binding: CloudAuthAttemptBinding, code: String,
        authBaseUrl: String, bearer: String
    ) async throws -> CloudAccountProofCompletion {
        let result: CloudAccountProofCompletion = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/account/reauth/email", body: self.encoder.encode(AccountEmailComplete(client: binding.client,
                codeVerifier: binding.codeVerifier, attempt: attempt.attempt, code: code)))
        try result.validate()
        return result
    }

    func completeLink(completion: String, binding: CloudAuthAttemptBinding, authBaseUrl: String, bearer: String) async throws {
        let result: AccountMutationResult = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/account/provider-methods/link", body: self.encoder.encode(AccountLinkComplete(client: binding.client,
                codeVerifier: binding.codeVerifier, completion: completion)))
        try self.validateMutation(result, purpose: "link")
    }

    func unlink(target: CloudAccountProviderTarget, proof: CloudAccountReauthenticationReceipt, authBaseUrl: String, bearer: String) async throws {
        let result: AccountMutationResult = try await self.request(authBaseUrl: authBaseUrl, bearer: bearer,
            path: "/api/account/provider-methods/unlink", body: self.encoder.encode(AccountUnlink(client: .currentNative, target: target, proof: proof)))
        try self.validateMutation(result, purpose: nil)
    }

    private func mailboxBody(attempt: CloudAccountProviderAttempt, action: String, email: String?, code: String?) throws -> Data {
        try self.encoder.encode(AccountProviderComplete(action: action, purpose: attempt.purpose, client: attempt.binding.client,
            codeVerifier: attempt.binding.codeVerifier, attempt: attempt.response.attempt, provider: nil,
            identityToken: nil, authorizationCode: nil, email: email, code: code))
    }

    private func validateMutation(_ result: AccountMutationResult, purpose: String?) throws {
        try requireCloudSocialContract(result.ok && result.purpose == purpose, "Invalid account-method mutation result")
    }

    private func request<Response: Decodable>(authBaseUrl: String, bearer: String, path: String, body: Data?) async throws -> Response {
        let base = authBaseUrl.hasSuffix("/") ? String(authBaseUrl.dropLast()) : authBaseUrl
        guard let components = URLComponents(string: base), components.scheme == "https",
              components.host?.isEmpty == false, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil, let url = URL(string: base + path) else {
            throw CloudAuthError.invalidBaseUrl(authBaseUrl)
        }
        guard !bearer.isEmpty else { throw CloudAccountMethodError.sessionRequired }
        try Task.checkCancellation()
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CloudAuthError.invalidResponseBody("Account methods did not receive an HTTP response")
        }
        let requestId = http.value(forHTTPHeaderField: "X-Request-Id")
        guard (200..<300).contains(http.statusCode) else {
            throw CloudAuthError.invalidResponse(decodeCloudApiErrorDetails(data: data, requestId: requestId,
                retryAfterDelayNanoseconds: cloudRetryAfterDelayNanoseconds(value: http.value(forHTTPHeaderField: "Retry-After"))), http.statusCode)
        }
        do { return try self.decoder.decode(Response.self, from: data) }
        catch {
            throw CloudAuthError.invalidResponse(CloudApiErrorDetails(message: "Account-method response failed the \(Response.self) contract",
                requestId: requestId, code: "RESPONSE_CONTRACT_FAILED", syncConflict: nil), http.statusCode)
        }
    }
}
