import Foundation

let aiConsentDisclosureVersion: String = "2026-10-12.1"
let aiConsentStateUserDefaultsKey: String = "ai-consent-ledger"
let aiConsentIdHeader: String = "X-AI-Consent-Id"

struct AIConsentDisclosure: Equatable, Sendable {
    let locale: String
    let text: String

    static func current() -> AIConsentDisclosure {
        AIConsentDisclosure(
            locale: currentAppUILocaleIdentifier(preferredLocalizations: Bundle.main.preferredLocalizations) ?? "en",
            text: aiSettingsLocalized(
                "ai.consent.dataSharingBody",
                "Nibomo sends your messages, relevant chat and workspace data, selected files or photos, and recorded dictation audio to OpenAI for AI requests. Nibomo saves your chats. AI can make mistakes; check important results. You can turn off AI data sharing in Settings."
            )
        )
    }
}

enum AIConsentAction: String, Codable, Sendable {
    case grant
    case withdraw
}

struct AIConsentEvidence: Codable, Equatable, Sendable {
    let eventId: UUID
    let installationId: UUID
    let action: AIConsentAction
    let decisionSequence: Int
    let occurredAt: String
    let disclosureVersion: String
    let locale: String
    let disclosureText: String
    let appVersion: String
    let appBuild: String
    let platform: String
}

struct AIConsentReceipt: Codable, Equatable, Sendable {
    let eventId: UUID
    let installationId: UUID
    let action: AIConsentAction
    let decisionSequence: Int
    let disclosureVersion: String
    let occurredAt: String
    let receivedAt: String

    func matches(_ evidence: AIConsentEvidence) -> Bool {
        self.eventId == evidence.eventId && self.installationId == evidence.installationId
            && self.action == evidence.action && self.decisionSequence == evidence.decisionSequence
            && self.disclosureVersion == evidence.disclosureVersion
            && aiConsentDate(self.occurredAt) == aiConsentDate(evidence.occurredAt)
            && aiConsentDate(self.occurredAt) != nil && aiConsentDate(self.receivedAt) != nil
    }
}

struct AIConsentActor: Codable, Equatable, Sendable {
    let userId: String
    let apiBaseUrl: String

    init(userId: String, apiBaseUrl: String) {
        self.userId = userId
        self.apiBaseUrl = apiBaseUrl
    }

    init(session: CloudLinkedSession) {
        self.userId = session.userId
        self.apiBaseUrl = session.apiBaseUrl
    }
}

struct AIConsentDecision: Codable, Equatable, Sendable {
    let identityId: UUID
    let evidence: AIConsentEvidence
    var actor: AIConsentActor?
    var owner: AIConsentActor?
    var receipt: AIConsentReceipt?
}

struct AIConsentLedger: Codable, Sendable {
    let installationId: UUID
    var identityId: UUID
    var decisionSequence: Int
    var decisions: [AIConsentDecision]
}

enum AIConsentError: LocalizedError {
    case required
    case identityChanged
    case invalidReceipt
    case invalidState
    case responseNotOk(Int, CloudApiErrorDetails)

    var errorDescription: String? {
        switch self {
        case .required, .identityChanged, .invalidReceipt, .invalidState, .responseNotOk:
            return aiSettingsLocalized("ai.consent.saveFailed", "Your choice could not be saved. Try again before using AI.")
        }
    }
}

func aiConsentDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
}

func aiConsentActionTime() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: Date())
}
