import Foundation

enum CloudAuthProvider: String, Codable, Hashable {
    case apple
    case google
}

enum CloudAuthClient: String, Codable, Hashable {
    case ios
    case iosDevelopment = "ios-development"
    case macos
    case macosDevelopment = "macos-development"
}

enum CloudAuthProviderAvailability: Decodable {
    case unavailable
    case native(audience: String, presenterClientIds: [String], nonce: Nonce)

    enum Nonce: String, Decodable {
        case raw
        case sha256LowercaseHex = "sha256-lowercase-hex"
    }

    private enum CodingKeys: String, CodingKey {
        case available, transport, audience, presenterClientIds, nonce
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        guard try fields.decode(Bool.self, forKey: .available) else {
            self = .unavailable
            return
        }
        let transport = try fields.decode(String.self, forKey: .transport)
        let audience = try fields.decode(String.self, forKey: .audience)
        let presenters = try fields.decode([String].self, forKey: .presenterClientIds)
        try requireCloudSocialContract(transport == "native" && !audience.isEmpty
            && !presenters.isEmpty && presenters.allSatisfy { !$0.isEmpty }, "Invalid native provider metadata")
        self = .native(audience: audience, presenterClientIds: presenters,
            nonce: try fields.decode(Nonce.self, forKey: .nonce))
    }
}

struct CloudAuthMethods: Decodable {
    let client: CloudAuthClient
    let methods: Methods
    let endpoints: Endpoints
    let completion: Completion

    struct Methods: Decodable {
        let email: Email
        let apple: CloudAuthProviderAvailability
        let google: CloudAuthProviderAvailability

        struct Email: Decodable {
            let available: Bool
            let transport: String
        }
    }

    struct Endpoints: Decodable {
        let attempt: String
        let complete: String
    }

    struct Completion: Decodable {
        let codeChallengeMethod: String
        let tokenEnvelope: String
        let productAccountProvisioned: Bool
    }

    func validate(client: CloudAuthClient) throws {
        try requireCloudSocialContract(self.client == client && self.methods.email.available
            && self.methods.email.transport == "email_otp" && self.endpoints.attempt == "/api/social/attempt"
            && self.endpoints.complete == "/api/social/complete" && self.completion.codeChallengeMethod == "S256"
            && self.completion.tokenEnvelope == "TokenResult" && !self.completion.productAccountProvisioned,
            "Unsupported native login metadata")
        if case .native(_, _, let nonce) = self.methods.apple {
            try requireCloudSocialContract(nonce == .sha256LowercaseHex, "Apple nonce format is invalid")
        }
        if case .native(_, _, let nonce) = self.methods.google {
            try requireCloudSocialContract(nonce == .raw, "Google nonce format is invalid")
        }
    }
}

struct CloudSocialAttemptResponse: Decodable {
    let attempt: String
    let nonce: String
    let expiresAt: String
    let redirectUri: String?
    let providerCodeChallenge: String

    private enum CodingKeys: String, CodingKey {
        case attempt, nonce, expiresAt, redirectUri, providerCodeChallenge
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.attempt = try fields.decode(String.self, forKey: .attempt)
        self.nonce = try fields.decode(String.self, forKey: .nonce)
        self.expiresAt = try fields.decode(String.self, forKey: .expiresAt)
        self.redirectUri = try fields.decode(String?.self, forKey: .redirectUri)
        self.providerCodeChallenge = try fields.decode(String.self, forKey: .providerCodeChallenge)
        try requireCloudSocialContract(cloudSocialHandleIsValid(self.attempt)
            && cloudSocialHandleIsValid(self.providerCodeChallenge) && parseIsoTimestamp(value: self.expiresAt) != nil
            && self.redirectUri == nil, "Invalid native login attempt")
    }
}

struct CloudSocialLoginAttempt {
    let provider: CloudAuthProvider
    let binding: CloudAuthAttemptBinding
    let authBaseUrl: String
    let response: CloudSocialAttemptResponse
}

enum CloudSocialProviderProof {
    case apple(identityToken: String, authorizationCode: String)
    case google(identityToken: String)
}

struct CloudSocialMailboxChallenge {
    let login: CloudSocialLoginAttempt
    let reason: CloudSocialMailboxReason
    let providerEmail: String?
}

enum CloudSocialMailboxReason: String, Decodable {
    case mailboxRequired = "mailbox_required"
    case existingEmail = "existing_email"
    case historicalBinding = "historical_binding"
}

struct CloudSocialCompletion {
    let login: CloudSocialLoginAttempt
    let completion: String
    let expiresAt: String
}

enum CloudSocialContinuation {
    case verificationRequired(CloudSocialMailboxChallenge)
    case completed(CloudSocialCompletion)
}

enum CloudSocialContinuationResponse: Decodable {
    case verificationRequired(reason: CloudSocialMailboxReason, providerEmail: String?)
    case completed(completion: String, expiresAt: String)

    private enum CodingKeys: String, CodingKey {
        case status, reason, providerEmail, completion, expiresAt
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        switch try fields.decode(String.self, forKey: .status) {
        case "verification_required":
            let email = try fields.decode(String?.self, forKey: .providerEmail)
            try requireCloudSocialContract(email == nil || cloudSocialEmailIsValid(email!), "Invalid provider mailbox")
            self = .verificationRequired(reason: try fields.decode(CloudSocialMailboxReason.self, forKey: .reason),
                providerEmail: email)
        case "completed":
            let completion = try fields.decode(String.self, forKey: .completion)
            let expiresAt = try fields.decode(String.self, forKey: .expiresAt)
            try requireCloudSocialContract(cloudSocialHandleIsValid(completion)
                && parseIsoTimestamp(value: expiresAt) != nil, "Invalid login completion")
            self = .completed(completion: completion, expiresAt: expiresAt)
        default:
            throw CloudAuthError.invalidResponseBody("Unexpected native login continuation status")
        }
    }

    func continuation(login: CloudSocialLoginAttempt) -> CloudSocialContinuation {
        switch self {
        case .verificationRequired(let reason, let providerEmail):
            return .verificationRequired(CloudSocialMailboxChallenge(login: login, reason: reason, providerEmail: providerEmail))
        case .completed(let completion, let expiresAt):
            return .completed(CloudSocialCompletion(login: login, completion: completion, expiresAt: expiresAt))
        }
    }
}

struct CloudSocialSignInHint: Decodable {
    let method: CloudAuthProvider
    let recoveryEmail: String
    let providerEmail: String?
    let emailRelationship: EmailRelationship

    enum EmailRelationship: String, Decodable {
        case missing
        case matchesRecovery = "matches_recovery"
        case differentFromRecovery = "different_from_recovery"
    }

    private enum CodingKeys: String, CodingKey {
        case method, recoveryEmail, providerEmail, emailRelationship
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.method = try fields.decode(CloudAuthProvider.self, forKey: .method)
        self.recoveryEmail = try fields.decode(String.self, forKey: .recoveryEmail)
        self.providerEmail = try fields.decode(String?.self, forKey: .providerEmail)
        self.emailRelationship = try fields.decode(EmailRelationship.self, forKey: .emailRelationship)
        let relationship: EmailRelationship = self.providerEmail == nil ? .missing
            : self.providerEmail == self.recoveryEmail ? .matchesRecovery : .differentFromRecovery
        try requireCloudSocialContract(cloudSocialEmailIsValid(self.recoveryEmail)
            && (self.providerEmail == nil || cloudSocialEmailIsValid(self.providerEmail!))
            && self.emailRelationship == relationship, "Invalid successful sign-in hint relationship")
    }
}

struct CloudSocialSession {
    let credentials: StoredCloudCredentials
    let signInHint: CloudSocialSignInHint
}

struct CloudSocialTokenResponse: Decodable {
    let ok: Bool
    let idToken: String
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let signInHint: CloudSocialSignInHint

    func session(provider: CloudAuthProvider, now: Date) throws -> CloudSocialSession {
        try requireCloudSocialContract(self.ok && !self.idToken.isEmpty && !self.accessToken.isEmpty
            && !self.refreshToken.isEmpty && self.expiresIn > 0 && self.signInHint.method == provider,
            "Invalid redeemed native login session")
        return CloudSocialSession(credentials: StoredCloudCredentials(refreshToken: self.refreshToken,
            idToken: self.idToken, idTokenExpiresAt: makeIdTokenExpiryTimestamp(now: now, expiresInSeconds: self.expiresIn)),
            signInHint: self.signInHint)
    }
}

func requireCloudSocialContract(_ condition: Bool, _ message: String) throws {
    guard condition else { throw CloudAuthError.invalidResponseBody(message) }
}

func cloudSocialHandleIsValid(_ value: String) -> Bool {
    value.utf8.count == 43 && value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
}

private func cloudSocialEmailIsValid(_ value: String) -> Bool {
    value.count <= 254 && value.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
}
