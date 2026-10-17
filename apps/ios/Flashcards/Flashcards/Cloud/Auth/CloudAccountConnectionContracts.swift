import Foundation

struct CloudConnectionSuggestion: Decodable {
    let suggestion: String
    let expiresAt: String

    func validate() throws {
        try requireCloudSocialContract(cloudSocialHandleIsValid(self.suggestion)
            && parseIsoTimestamp(value: self.expiresAt) != nil, "Invalid account connection suggestion")
    }
}

struct CloudPendingConnectionSuggestion {
    let suggestion: CloudConnectionSuggestion
    let binding: CloudAuthAttemptBinding
    let configuration: CloudServiceConfiguration
    let credentials: StoredCloudCredentials
}

struct CloudConnectionPreview: Decodable {
    struct Choices: Decodable {
        struct Baseline: Decodable { let workspace: String; let cards: String }
        let operationId: UUID
        let omittedWorkspaceIds: [String]
        let historicalBaselines: [String: Baseline]
        let preview: UnionPreview
        let digest: String
    }
    struct UnionPreview: Decodable {
        struct Entry: Decodable {
            struct Workspace: Decodable {
                let workspace_id: String
                let name: String
                let creation_origin: String
                let starter_suppressed_at: String?
            }
            let workspace: Workspace
            let unusedStarter: Bool
        }
        let workspaces: [Entry]
        let workspaceIds: [String]
        let selectedWorkspaceId: String
        let suppressedWorkspaceIds: [String]
        let settingsPolicy: String
        let publicProfilePolicy: String
    }
    struct Consequences: Decodable {
        let data: String; let memberships: String; let integrations: String; let billing: String
        let subscriptions: String; let trials: String; let primaryEmail: String
    }
    let operation: String
    let choices: Choices
    let omissionCandidateWorkspaceIds: [String]
    let consequences: Consequences

    func validate() throws {
        let preview = self.choices.preview
        try requireCloudSocialContract(cloudSocialHandleIsValid(self.operation)
            && self.choices.digest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
            && preview.workspaceIds.contains(preview.selectedWorkspaceId)
            && preview.workspaces.contains { $0.workspace.workspace_id == preview.selectedWorkspaceId }
            && self.omissionCandidateWorkspaceIds.allSatisfy { id in
                preview.workspaces.contains { $0.workspace.workspace_id == id }
            }
            && self.choices.omittedWorkspaceIds.allSatisfy { self.choices.historicalBaselines[$0] != nil }
            && preview.settingsPolicy == "target_with_restrictive_privacy"
            && preview.publicProfilePolicy == "target_with_restrictive_visibility"
            && self.consequences.data == "retained" && self.consequences.memberships == "union_with_owner_precedence"
            && self.consequences.integrations == "credentials_keep_ids_and_follow_canonical_account"
            && self.consequences.billing == "purchases_grants_and_usage_follow_canonical_account"
            && self.consequences.subscriptions == "provider_subscriptions_unchanged"
            && self.consequences.trials == "original_trial_history_retained"
            && self.consequences.primaryEmail == "retain_genuine_primary_or_use_proved_usable_real_email",
            "Unsupported account connection preview")
    }
}

struct CloudConnectionCommitted: Decodable {
    let operationId: UUID
    let sourceUserId: String
    let canonicalAccountId: String
    let selectedWorkspaceId: String
    let workspaceIds: [String]
    let suppressedWorkspaceIds: [String]
}

enum CloudConnectionOutcome: Equatable { case connected, alreadyConnected, cancelled }

enum CloudConnectionResponse: Decodable {
    case proofRequired(String), proved(String), alreadyConnected, cancelled
    case providerRequired(CloudSocialAttemptResponse)
    case emailRequired(String)
    case preview(CloudConnectionPreview)
    case connected(CloudConnectionCommitted)

    private enum Keys: String, CodingKey { case status, receipt, operation, proof, email, expiresAt, result, operationId }
    private struct Receipt: Decodable { let operation: String; let expiresAt: String }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        switch try fields.decode(String.self, forKey: .status) {
        case "proof_required", "proved":
            let receipt = try fields.decode(Receipt.self, forKey: .receipt)
            try requireCloudSocialContract(cloudSocialHandleIsValid(receipt.operation)
                && parseIsoTimestamp(value: receipt.expiresAt) != nil, "Invalid account connection receipt")
            let status = try fields.decode(String.self, forKey: .status)
            self = status == "proved" ? .proved(receipt.operation) : .proofRequired(receipt.operation)
        case "already_connected", "cancelled":
            let operation = try fields.decode(String.self, forKey: .operation)
            try requireCloudSocialContract(cloudSocialHandleIsValid(operation), "Invalid terminal connection operation")
            let status = try fields.decode(String.self, forKey: .status)
            self = status == "already_connected" ? .alreadyConnected : .cancelled
        case "provider_required": self = .providerRequired(try fields.decode(CloudSocialAttemptResponse.self, forKey: .proof))
        case "email_required":
            let email = try fields.decode(String.self, forKey: .email)
            let expiry = try fields.decode(String.self, forKey: .expiresAt)
            try requireCloudSocialContract(cloudAccountMailboxIsValid(email)
                && parseIsoTimestamp(value: expiry) != nil, "Invalid account connection email destination")
            self = .emailRequired(email)
        case "preview":
            let preview = try CloudConnectionPreview(from: decoder)
            try preview.validate()
            self = .preview(preview)
        case "connected":
            let result = try fields.decode(CloudConnectionCommitted.self, forKey: .result)
            let operationId = try fields.decode(UUID.self, forKey: .operationId)
            try requireCloudSocialContract(result.operationId == operationId
                && !result.canonicalAccountId.isEmpty && !result.sourceUserId.isEmpty
                && result.workspaceIds.contains(result.selectedWorkspaceId), "Invalid committed connection result")
            self = .connected(result)
        default: throw CloudAccountMethodError.freshAttemptRequired
        }
    }
}

enum CloudConnectionAction {
    case begin(String), adopt(String), load, cancel
    case providerBegin(CloudAuthProvider), providerComplete(CloudAuthProvider, String, CloudSocialProviderProof)
    case emailSend(String), emailVerify(String), preview([String]), confirm(CloudConnectionPreview)
}

struct CloudConnectionRequest: Encodable {
    let binding: CloudAuthAttemptBinding
    let operation: String?
    let action: CloudConnectionAction
    private enum Keys: String, CodingKey {
        case client, codeVerifier, operation, action, capability, sourceCompletion, suggestion, provider, codeChallenge
        case attempt, submission, email, code, omittedWorkspaceIds, previewDigest, accepted, identityToken, authorizationCode
    }
    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: Keys.self)
        try fields.encode(self.binding.client, forKey: .client)
        try fields.encode(self.binding.codeVerifier, forKey: .codeVerifier)
        try fields.encodeIfPresent(self.operation, forKey: .operation)
        switch self.action {
        case .begin(let completion):
            try fields.encode("begin", forKey: .action); try fields.encode(completion, forKey: .sourceCompletion)
            try fields.encode("canonical-account-v1", forKey: .capability)
        case .adopt(let suggestion):
            try fields.encode("adopt", forKey: .action); try fields.encode(suggestion, forKey: .suggestion)
            try fields.encode("canonical-account-v1", forKey: .capability)
        case .load: try fields.encode("load", forKey: .action)
        case .cancel: try fields.encode("cancel", forKey: .action)
        case .providerBegin(let provider):
            try fields.encode("provider_begin", forKey: .action); try fields.encode(provider, forKey: .provider)
            try fields.encode(self.binding.codeChallenge, forKey: .codeChallenge)
        case .providerComplete(let provider, let attempt, let proof):
            try fields.encode("provider_complete", forKey: .action); try fields.encode(attempt, forKey: .attempt)
            var submission = fields.nestedContainer(keyedBy: Keys.self, forKey: .submission)
            try submission.encode(provider, forKey: .provider)
            switch proof {
            case .apple(let token, let code):
                try requireCloudSocialContract(provider == .apple, "Connection provider changed")
                try submission.encode(token, forKey: .identityToken); try submission.encode(code, forKey: .authorizationCode)
            case .google(let token):
                try requireCloudSocialContract(provider == .google, "Connection provider changed")
                try submission.encode(token, forKey: .identityToken); try submission.encodeNil(forKey: .authorizationCode)
            }
        case .emailSend(let email):
            try fields.encode("email_send", forKey: .action); try fields.encode(email, forKey: .email)
        case .emailVerify(let code):
            try fields.encode("email_verify", forKey: .action); try fields.encode(code, forKey: .code)
        case .preview(let ids):
            try fields.encode("preview", forKey: .action); try fields.encode(ids, forKey: .omittedWorkspaceIds)
        case .confirm(let preview):
            try fields.encode("confirm", forKey: .action)
            try fields.encode(preview.choices.omittedWorkspaceIds, forKey: .omittedWorkspaceIds)
            try fields.encode(preview.choices.digest, forKey: .previewDigest); try fields.encode(true, forKey: .accepted)
        }
    }
}
