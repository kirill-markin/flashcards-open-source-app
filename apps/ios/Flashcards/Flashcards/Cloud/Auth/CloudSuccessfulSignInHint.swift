import Foundation

enum CloudSignInMethod: String, Codable, Hashable {
    case apple
    case google
    case email

    init(provider: CloudAuthProvider) {
        self = provider == .apple ? .apple : .google
    }
}

struct CloudEmailSignInHint: Decodable {
    let method: CloudSignInMethod
    let email: String

    private enum CodingKeys: String, CodingKey {
        case method, email
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.method = try fields.decode(CloudSignInMethod.self, forKey: .method)
        self.email = try fields.decode(String.self, forKey: .email)
        try requireCloudSocialContract(self.method == .email && cloudSignInHintEmailIsValid(self.email),
            "Invalid successful email sign-in hint")
    }
}

struct CloudEmailSession {
    let credentials: StoredCloudCredentials
    let signInHint: CloudEmailSignInHint?
}

struct CloudSuccessfulSignInHint: Codable, Hashable {
    let method: CloudSignInMethod
    // This is the initiating method's proved email, never a profile/recovery substitute.
    let email: String?
    let emailRelationship: EmailRelationship

    enum EmailRelationship: String, Codable, Hashable {
        case verifiedEmail
        case missing
        case matchesRecovery
        case differentFromRecovery
    }

    init(social: CloudSocialSignInHint) {
        self.method = CloudSignInMethod(provider: social.method)
        self.email = social.providerEmail
        switch social.emailRelationship {
        case .missing: self.emailRelationship = .missing
        case .matchesRecovery: self.emailRelationship = .matchesRecovery
        case .differentFromRecovery: self.emailRelationship = .differentFromRecovery
        }
    }

    init(email: CloudEmailSignInHint) {
        self.method = .email
        self.email = email.email
        self.emailRelationship = .verifiedEmail
    }

    private enum CodingKeys: String, CodingKey {
        case method, email, emailRelationship
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.method = try fields.decode(CloudSignInMethod.self, forKey: .method)
        self.email = try fields.decodeIfPresent(String.self, forKey: .email)
        self.emailRelationship = try fields.decode(EmailRelationship.self, forKey: .emailRelationship)
        let validRelationship = self.method == .email
            ? self.emailRelationship == .verifiedEmail && self.email != nil
            : self.emailRelationship != .verifiedEmail
                && ((self.email == nil) == (self.emailRelationship == .missing))
        try requireCloudSocialContract(validRelationship
            && (self.email.map(cloudSignInHintEmailIsValid) ?? true), "Invalid stored sign-in hint")
    }
}

private func cloudSignInHintEmailIsValid(_ value: String) -> Bool {
    value.count <= 254 && value.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
}
