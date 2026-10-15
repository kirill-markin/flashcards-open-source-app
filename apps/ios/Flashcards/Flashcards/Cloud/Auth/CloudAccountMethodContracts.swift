import Foundation

struct CloudAccountProviderTarget: Codable, Hashable {
    let provider: CloudAuthProvider
    let providerSubject: String
    let generation: String
}

struct CloudAccountProviderMethod: Decodable, Hashable {
    enum Status: String, Decodable { case active, disabled }
    let provider: CloudAuthProvider
    let providerSubject: String
    let status: Status
    let generation: String
    let revocationPending: Bool

    var target: CloudAccountProviderTarget {
        CloudAccountProviderTarget(provider: self.provider, providerSubject: self.providerSubject, generation: self.generation)
    }
}

struct CloudAccountLoginMethods: Decodable {
    let methods: [CloudAccountProviderMethod]
    let verifiedRecoveryEmails: [String]
    let emailRecovery: String
    let csrfToken: String?

    private enum CodingKeys: String, CodingKey { case methods, verifiedRecoveryEmails, emailRecovery, csrfToken }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.methods = try fields.decode([CloudAccountProviderMethod].self, forKey: .methods)
        self.verifiedRecoveryEmails = try fields.decode([String].self, forKey: .verifiedRecoveryEmails)
        self.emailRecovery = try fields.decode(String.self, forKey: .emailRecovery)
        self.csrfToken = try fields.decode(String?.self, forKey: .csrfToken)
        try requireCloudSocialContract(self.emailRecovery == "read_only" && self.csrfToken == nil
            && self.methods.allSatisfy { !$0.providerSubject.isEmpty && $0.providerSubject.count <= 255
                && $0.generation.count <= 64 && $0.generation.contains { !$0.isWhitespace }
                && $0.generation.unicodeScalars.allSatisfy { $0.value >= 0x20 && $0.value <= 0x7E } }
            && Set(self.methods.map { "\($0.provider.rawValue):\($0.providerSubject)" }).count == self.methods.count
            && self.verifiedRecoveryEmails.allSatisfy(cloudAccountMailboxIsValid)
            && Set(self.verifiedRecoveryEmails).count == self.verifiedRecoveryEmails.count,
            "Invalid authenticated account-method metadata")
    }
}

enum CloudAccountMethodOperation: Hashable {
    case link(CloudAuthProvider)
    case unlink(CloudAccountProviderTarget)
    case reenable(CloudAccountProviderTarget)

    var provider: CloudAuthProvider {
        switch self {
        case .link(let provider): return provider
        case .unlink(let target), .reenable(let target): return target.provider
        }
    }

    var mutation: CloudAccountMethodMutation {
        switch self {
        case .link: return .link
        case .unlink: return .unlink
        case .reenable: return .reenable
        }
    }
}

enum CloudAccountMethodMutation { case link, unlink, reenable }

enum CloudAccountProofPurpose: String, Encodable { case reauth, link }

struct CloudAccountReauthenticationReceipt: Encodable {
    let completion: String
    let client: CloudAuthClient
    let codeVerifier: String

    init(completion: String, binding: CloudAuthAttemptBinding) {
        self.completion = completion
        self.client = binding.client
        self.codeVerifier = binding.codeVerifier
    }
}

struct CloudAccountProviderAttempt {
    let provider: CloudAuthProvider
    let purpose: CloudAccountProofPurpose
    let binding: CloudAuthAttemptBinding
    let response: CloudSocialAttemptResponse

    // The vendor SDK only presents the server's nonce/state; this value never enters login transport.
    func presentationAttempt(authBaseUrl: String) -> CloudSocialLoginAttempt {
        CloudSocialLoginAttempt(provider: self.provider, binding: self.binding, authBaseUrl: authBaseUrl, response: self.response)
    }
}

struct CloudAccountEmailAttempt: Decodable {
    let attempt: String
    let expiresAt: String

    func validate() throws {
        try requireCloudSocialContract(cloudSocialHandleIsValid(self.attempt)
            && parseIsoTimestamp(value: self.expiresAt) != nil, "Invalid current-email reauthentication attempt")
    }
}

struct CloudAccountProofCompletion: Decodable {
    let completion: String
    let expiresAt: String

    func validate() throws {
        try requireCloudSocialContract(cloudSocialHandleIsValid(self.completion)
            && parseIsoTimestamp(value: self.expiresAt) != nil, "Invalid current-account proof receipt")
    }
}

struct CloudAccountMailboxChallenge {
    let attempt: CloudAccountProviderAttempt
    let reason: CloudSocialMailboxReason
    let providerEmail: String?
}

enum CloudAccountMethodError: Error {
    case sessionRequired
    case currentAccountChanged
    case freshAttemptRequired
    case methodChanged
    case cleanupRequired
    case currentEmailUnavailable
    case invalidPhase
}

func cloudAccountMailboxIsValid(_ value: String) -> Bool {
    value.count <= 254 && value.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
}
