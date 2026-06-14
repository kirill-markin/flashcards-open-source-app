import Foundation

let feedbackMessageMaximumCharacters: Int = 5000
let feedbackAutomaticReviewThreshold: Int = 15
let feedbackAutomaticPromptCooldownSeconds: TimeInterval = 30 * 24 * 60 * 60
let feedbackServerStateStaleSeconds: TimeInterval = 24 * 60 * 60
let feedbackAutomaticPromptFailureBackoffSeconds: TimeInterval = 30 * 60

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
    let locale: String
    let timezone: String
    let eventType: String
    let createdAtClient: String
}

struct FeedbackSubmissionRequest: Encodable, Hashable, Sendable {
    let feedbackSubmissionId: String
    let workspaceId: String?
    let installationId: String?
    let platform: String
    let appVersion: String?
    let locale: String
    let timezone: String
    let trigger: String
    let message: String
    let createdAtClient: String
}

struct FeedbackPresentation: Identifiable, Hashable, Sendable {
    let id: String
    let trigger: FeedbackTrigger
}

struct PersistedFeedbackPromptState: Codable, Hashable, Sendable {
    let lastAutomaticPromptShownAt: Date?
    let lastFeedbackSubmittedAt: Date?
    let serverNextAutomaticPromptAt: Date?
    let lastServerStateFetchedAt: Date?
}

struct FeedbackReviewActivitySummary: Hashable, Sendable {
    let hasPreviousLocalReviewDay: Bool
    let currentLocalDayReviewCount: Int
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
    PersistedFeedbackPromptState(
        lastAutomaticPromptShownAt: nil,
        lastFeedbackSubmittedAt: nil,
        serverNextAutomaticPromptAt: nil,
        lastServerStateFetchedAt: nil
    )
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

func shouldFetchFeedbackServerState(
    promptState: PersistedFeedbackPromptState,
    now: Date
) -> Bool {
    guard let lastServerStateFetchedAt = promptState.lastServerStateFetchedAt else {
        return true
    }

    return now.timeIntervalSince(lastServerStateFetchedAt) >= feedbackServerStateStaleSeconds
}

func isFeedbackAutomaticCooldownExpired(
    promptState: PersistedFeedbackPromptState,
    now: Date
) -> Bool {
    guard let nextPromptAt = nextFeedbackAutomaticPromptAt(promptState: promptState) else {
        return true
    }

    return now >= nextPromptAt
}

func nextFeedbackAutomaticPromptAt(promptState: PersistedFeedbackPromptState) -> Date? {
    let localCooldownBase = [
        promptState.lastAutomaticPromptShownAt,
        promptState.lastFeedbackSubmittedAt
    ].compactMap { date in
        date
    }.max()

    let localNextPromptAt = localCooldownBase.map { date in
        date.addingTimeInterval(feedbackAutomaticPromptCooldownSeconds)
    }

    return [
        localNextPromptAt,
        promptState.serverNextAutomaticPromptAt
    ].compactMap { date in
        date
    }.max()
}

func applyFeedbackServerState(
    promptState: PersistedFeedbackPromptState,
    feedbackState: FeedbackState,
    fetchedAt: Date
) -> PersistedFeedbackPromptState {
    PersistedFeedbackPromptState(
        lastAutomaticPromptShownAt: promptState.lastAutomaticPromptShownAt,
        lastFeedbackSubmittedAt: promptState.lastFeedbackSubmittedAt,
        serverNextAutomaticPromptAt: feedbackState.nextAutomaticPromptAt.flatMap { value in
            parseIsoTimestamp(value: value)
        },
        lastServerStateFetchedAt: fetchedAt
    )
}

func makeFeedbackPromptStateAfterAutomaticPromptShown(
    promptState: PersistedFeedbackPromptState,
    feedbackState: FeedbackState,
    shownAt: Date
) -> PersistedFeedbackPromptState {
    PersistedFeedbackPromptState(
        lastAutomaticPromptShownAt: shownAt,
        lastFeedbackSubmittedAt: promptState.lastFeedbackSubmittedAt,
        serverNextAutomaticPromptAt: feedbackState.nextAutomaticPromptAt.flatMap { value in
            parseIsoTimestamp(value: value)
        },
        lastServerStateFetchedAt: shownAt
    )
}

func makeFeedbackPromptStateAfterSubmission(
    promptState: PersistedFeedbackPromptState,
    feedbackState: FeedbackState,
    submittedAt: Date
) -> PersistedFeedbackPromptState {
    PersistedFeedbackPromptState(
        lastAutomaticPromptShownAt: promptState.lastAutomaticPromptShownAt,
        lastFeedbackSubmittedAt: submittedAt,
        serverNextAutomaticPromptAt: feedbackState.nextAutomaticPromptAt.flatMap { value in
            parseIsoTimestamp(value: value)
        },
        lastServerStateFetchedAt: submittedAt
    )
}

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
        locale: Locale.current.identifier,
        timezone: TimeZone.current.identifier,
        eventType: eventType.rawValue,
        createdAtClient: formatIsoTimestamp(date: now)
    )
}

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
        locale: Locale.current.identifier,
        timezone: TimeZone.current.identifier,
        trigger: trigger.rawValue,
        message: trimmedFeedbackMessage(message),
        createdAtClient: formatIsoTimestamp(date: now)
    )
}
