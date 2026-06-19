import Foundation

let reviewNotificationFallbackBodyText: String = String(
    localized: "review_notification.fallback_body",
    table: "Foundation",
    comment: "Fallback review notification body text"
)

let reviewNotificationScheduledPayloadsUserDefaultsKeyPrefix: String = "review-notification-scheduled-payloads::"
let reviewNotificationRequestIdentifierPrefix: String = "review-notification::"

struct ScheduledReviewNotificationPayload: Hashable, Sendable, Identifiable {
    let workspaceId: String
    let reviewFilter: PersistedReviewFilter
    let content: ScheduledReviewNotificationPayloadContent
    let scheduledAtMillis: Int64
    let requestId: String

    var id: String {
        self.requestId
    }

    var notificationBodyText: String {
        self.content.notificationBodyText
    }

    var cardId: String? {
        self.content.cardId
    }
}

enum ScheduledReviewNotificationPayloadContent: Hashable, Sendable {
    case card(cardId: String, frontText: String)
    case fallback

    var cardId: String? {
        switch self {
        case .card(let cardId, _):
            return cardId
        case .fallback:
            return nil
        }
    }

    var notificationBodyText: String {
        switch self {
        case .card(_, let frontText):
            return frontText
        case .fallback:
            return reviewNotificationFallbackBodyText
        }
    }
}

extension ScheduledReviewNotificationPayloadContent: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case cardId
        case frontText
    }

    private enum Kind: String, Codable {
        case card
        case fallback
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        switch kind {
        case .card:
            let cardId = try container.decode(String.self, forKey: .cardId)
            let frontText = try container.decode(String.self, forKey: .frontText)
            self = .card(cardId: cardId, frontText: frontText)
        case .fallback:
            self = .fallback
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .card(let cardId, let frontText):
            try container.encode(Kind.card, forKey: .kind)
            try container.encode(cardId, forKey: .cardId)
            try container.encode(frontText, forKey: .frontText)
        case .fallback:
            try container.encode(Kind.fallback, forKey: .kind)
        }
    }
}

extension ScheduledReviewNotificationPayload: Codable {
    private enum CodingKeys: String, CodingKey {
        case workspaceId
        case reviewFilter
        case content
        case scheduledAtMillis
        case requestId
        case cardId
        case frontText
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.workspaceId = try container.decode(String.self, forKey: .workspaceId)
        self.reviewFilter = try container.decode(PersistedReviewFilter.self, forKey: .reviewFilter)
        self.scheduledAtMillis = try container.decode(Int64.self, forKey: .scheduledAtMillis)
        self.requestId = try container.decode(String.self, forKey: .requestId)

        if let content = try container.decodeIfPresent(ScheduledReviewNotificationPayloadContent.self, forKey: .content) {
            self.content = content
            return
        }

        let cardId = try container.decode(String.self, forKey: .cardId)
        let frontText = try container.decode(String.self, forKey: .frontText)
        self.content = .card(cardId: cardId, frontText: frontText)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.workspaceId, forKey: .workspaceId)
        try container.encode(self.reviewFilter, forKey: .reviewFilter)
        try container.encode(self.content, forKey: .content)
        try container.encode(self.scheduledAtMillis, forKey: .scheduledAtMillis)
        try container.encode(self.requestId, forKey: .requestId)
    }
}

struct CurrentReviewNotificationCard: Hashable, Sendable {
    let reviewFilter: PersistedReviewFilter
    let cardId: String
    let frontText: String
}

func makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: String) -> String {
    "\(reviewNotificationScheduledPayloadsUserDefaultsKeyPrefix)\(workspaceId)"
}

func loadScheduledReviewNotifications(
    userDefaults: UserDefaults,
    decoder: JSONDecoder,
    workspaceId: String?
) -> [ScheduledReviewNotificationPayload] {
    guard
        let workspaceId,
        let data = userDefaults.data(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
    else {
        return []
    }

    do {
        return try decoder.decode([ScheduledReviewNotificationPayload].self, from: data)
    } catch {
        captureReviewNotificationsSilentFailure(
            error: error,
            action: "review_notifications_scheduled_payloads_load",
            stage: "decode",
            cloudSettings: nil,
            workspaceId: workspaceId,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        return []
    }
}

func makeReviewNotificationRequestIdentifier(workspaceId: String, kind: String, suffix: String) -> String {
    "\(reviewNotificationRequestIdentifierPrefix)\(workspaceId)::\(kind)::\(suffix)"
}

/// Review reminders are identified by the shared `review-notification::` identifier prefix.
func isReviewNotificationRequestIdentifier(identifier: String) -> Bool {
    identifier.hasPrefix(reviewNotificationRequestIdentifierPrefix)
}

func reviewNotificationRequestWorkspaceId(identifier: String) -> String? {
    guard identifier.hasPrefix(reviewNotificationRequestIdentifierPrefix) else {
        return nil
    }

    let prefixEndIndex = identifier.index(
        identifier.startIndex,
        offsetBy: reviewNotificationRequestIdentifierPrefix.count
    )
    let suffix = identifier[prefixEndIndex...]
    guard let separatorRange = suffix.range(of: "::") else {
        return nil
    }

    let workspaceId = String(suffix[..<separatorRange.lowerBound])
    guard workspaceId.isEmpty == false else {
        return nil
    }

    return workspaceId
}

/// Keeps only identifiers that belong to review reminders.
func filterReviewNotificationRequestIdentifiers(identifiers: [String]) -> [String] {
    identifiers.filter(isReviewNotificationRequestIdentifier)
}

func makeReviewNotificationRequestSuffix(scheduledAt: Date, calendar: Calendar) -> String {
    let dateFormatter = DateFormatter()
    dateFormatter.calendar = calendar
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")
    dateFormatter.dateFormat = "yyyy-MM-dd-HH-mm"
    return dateFormatter.string(from: scheduledAt)
}

func makeReviewNotificationRequestIdentifiers(
    workspaceId: String,
    scheduledPayloads: [ScheduledReviewNotificationPayload]
) -> [String] {
    scheduledPayloads.map(\.requestId)
}

func acceptedReviewNotificationPayloads(
    payloads: [ScheduledReviewNotificationPayload],
    pendingRequestIdentifiers: [String]
) -> [ScheduledReviewNotificationPayload] {
    let pendingRequestIdentifierSet: Set<String> = Set(pendingRequestIdentifiers)
    return payloads.filter { payload in
        pendingRequestIdentifierSet.contains(payload.requestId)
    }
}
