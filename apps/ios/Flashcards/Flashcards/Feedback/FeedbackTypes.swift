import Foundation

let feedbackMessageMaximumCharacters: Int = 5000

enum FeedbackTrigger: String, Codable, Hashable, Sendable {
    case settings
    case automatic
}

enum FeedbackPromptEventType: String, Codable, Hashable, Sendable {
    case automaticPromptShown = "automatic_prompt_shown"
}

struct FeedbackState: Codable, Hashable, Sendable {
    let automaticPromptCooldownDays: Int
    let lastAutomaticPromptShownAt: String?
    let lastFeedbackSubmittedAt: String?
    let nextAutomaticPromptAt: String?
}

struct FeedbackStateEnvelope: Codable, Hashable, Sendable {
    let feedbackState: FeedbackState
}

struct FeedbackPromptEventRequest: Encodable, Hashable, Sendable {
    let feedbackPromptEventId: String
    let workspaceId: String?
    let installationId: String?
    let platform: String
    let appVersion: String?
    let osName: String
    let deviceType: String
    let locale: String?
    let timezone: String
    let eventType: String
    let createdAtClient: String

    private enum CodingKeys: String, CodingKey {
        case feedbackPromptEventId
        case workspaceId
        case installationId
        case platform
        case appVersion
        case osName
        case deviceType
        case locale
        case timezone
        case eventType
        case createdAtClient
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.feedbackPromptEventId, forKey: .feedbackPromptEventId)
        try container.encode(self.workspaceId, forKey: .workspaceId)
        try container.encode(self.installationId, forKey: .installationId)
        try container.encode(self.platform, forKey: .platform)
        try container.encode(self.appVersion, forKey: .appVersion)
        try container.encode(self.osName, forKey: .osName)
        try container.encode(self.deviceType, forKey: .deviceType)
        try container.encode(self.locale, forKey: .locale)
        try container.encode(self.timezone, forKey: .timezone)
        try container.encode(self.eventType, forKey: .eventType)
        try container.encode(self.createdAtClient, forKey: .createdAtClient)
    }
}

struct FeedbackSubmissionRequest: Encodable, Hashable, Sendable {
    let feedbackSubmissionId: String
    let workspaceId: String?
    let installationId: String?
    let platform: String
    let appVersion: String?
    let osName: String
    let deviceType: String
    let locale: String?
    let timezone: String
    let trigger: String
    let message: String
    let createdAtClient: String

    private enum CodingKeys: String, CodingKey {
        case feedbackSubmissionId
        case workspaceId
        case installationId
        case platform
        case appVersion
        case osName
        case deviceType
        case locale
        case timezone
        case trigger
        case message
        case createdAtClient
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.feedbackSubmissionId, forKey: .feedbackSubmissionId)
        try container.encode(self.workspaceId, forKey: .workspaceId)
        try container.encode(self.installationId, forKey: .installationId)
        try container.encode(self.platform, forKey: .platform)
        try container.encode(self.appVersion, forKey: .appVersion)
        try container.encode(self.osName, forKey: .osName)
        try container.encode(self.deviceType, forKey: .deviceType)
        try container.encode(self.locale, forKey: .locale)
        try container.encode(self.timezone, forKey: .timezone)
        try container.encode(self.trigger, forKey: .trigger)
        try container.encode(self.message, forKey: .message)
        try container.encode(self.createdAtClient, forKey: .createdAtClient)
    }
}

struct FeedbackPresentation: Identifiable, Hashable, Sendable {
    let id: String
    let trigger: FeedbackTrigger
}

/// Only an automatic showing starts the automatic prompt's cooldown; submissions do not.
struct PersistedFeedbackPromptState: Codable, Hashable, Sendable {
    let lastAutomaticPromptShownAt: Date?
}

struct FeedbackPromptIdentityKey: Hashable, Sendable {
    let rawValue: String
}

private func trimmedFeedbackIdentityValue(_ value: String?) -> String? {
    guard let value else {
        return nil
    }

    let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedValue.isEmpty ? nil : trimmedValue
}

func makeFeedbackPromptIdentityKey(cloudSettings: CloudSettings?) -> FeedbackPromptIdentityKey {
    if let linkedUserId = trimmedFeedbackIdentityValue(cloudSettings?.linkedUserId) {
        return FeedbackPromptIdentityKey(rawValue: "user:\(linkedUserId)")
    }

    if let installationId = trimmedFeedbackIdentityValue(cloudSettings?.installationId) {
        return FeedbackPromptIdentityKey(rawValue: "installation:\(installationId)")
    }

    return FeedbackPromptIdentityKey(rawValue: "installation:local")
}

func makeDefaultFeedbackPromptState() -> PersistedFeedbackPromptState {
    PersistedFeedbackPromptState(lastAutomaticPromptShownAt: nil)
}

func makeFeedbackPresentation(trigger: FeedbackTrigger) -> FeedbackPresentation {
    FeedbackPresentation(
        id: UUID().uuidString.lowercased(),
        trigger: trigger
    )
}

func trimmedFeedbackMessage(_ message: String) -> String {
    message.trimmingCharacters(in: .whitespacesAndNewlines)
}

func feedbackMessageValidationError(message: String) -> String? {
    let trimmedMessage = trimmedFeedbackMessage(message)
    if trimmedMessage.count > feedbackMessageMaximumCharacters {
        return aiSettingsLocalizedFormat(
            "feedback.sheet.messageTooLong",
            "Keep feedback under %d characters.",
            feedbackMessageMaximumCharacters
        )
    }

    return nil
}

func isFeedbackSendEnabled(message: String, isSubmitting: Bool) -> Bool {
    if isSubmitting {
        return false
    }

    let trimmedMessage = trimmedFeedbackMessage(message)
    return trimmedMessage.isEmpty == false
        && trimmedMessage.count <= feedbackMessageMaximumCharacters
}

@MainActor
func makeFeedbackPromptEventRequest(
    workspaceId: String?,
    installationId: String?,
    eventType: FeedbackPromptEventType,
    now: Date
) -> FeedbackPromptEventRequest {
    FeedbackPromptEventRequest(
        feedbackPromptEventId: UUID().uuidString.lowercased(),
        workspaceId: workspaceId,
        installationId: installationId,
        platform: "ios",
        appVersion: appMarketingVersion(),
        osName: currentClientOsName(),
        deviceType: currentClientDeviceType(),
        locale: currentAppUILocaleIdentifier(),
        timezone: TimeZone.current.identifier,
        eventType: eventType.rawValue,
        createdAtClient: formatIsoTimestamp(date: now)
    )
}

@MainActor
func makeFeedbackSubmissionRequest(
    workspaceId: String?,
    installationId: String?,
    trigger: FeedbackTrigger,
    message: String,
    now: Date
) -> FeedbackSubmissionRequest {
    FeedbackSubmissionRequest(
        feedbackSubmissionId: UUID().uuidString.lowercased(),
        workspaceId: workspaceId,
        installationId: installationId,
        platform: "ios",
        appVersion: appMarketingVersion(),
        osName: currentClientOsName(),
        deviceType: currentClientDeviceType(),
        locale: currentAppUILocaleIdentifier(),
        timezone: TimeZone.current.identifier,
        trigger: trigger.rawValue,
        message: trimmedFeedbackMessage(message),
        createdAtClient: formatIsoTimestamp(date: now)
    )
}
