import Foundation

let aiChatRemainingMessagesNoticeThreshold: Int = 3

/**
 The part of `GET /me/ai-usage` the app reads. `remainingMessages` is nil when no monthly limit applies,
 which is never the same as zero. `monthEndsAt` is also when the allowance renews.
 */
struct AIMonthlyUsage: Decodable, Hashable, Sendable {
    let monthEndsAt: Date
    let remainingMessages: Int?
    let ownKeyMessages: Int

    private enum CodingKeys: String, CodingKey {
        case monthEndsAt
        case remainingMessages
        case ownKeyMessages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let monthEndsAtValue = try container.decode(String.self, forKey: .monthEndsAt)
        guard let monthEndsAt = parseIsoTimestamp(value: monthEndsAtValue) else {
            throw DecodingError.dataCorruptedError(
                forKey: .monthEndsAt,
                in: container,
                debugDescription: "monthEndsAt is not an ISO 8601 timestamp: \(monthEndsAtValue)"
            )
        }

        self.monthEndsAt = monthEndsAt
        self.remainingMessages = try container.decode(Int?.self, forKey: .remainingMessages)
        self.ownKeyMessages = try container.decode(Int.self, forKey: .ownKeyMessages)
    }
}

struct AIUsageStatusResponse: Decodable, Sendable {
    let usage: AIMonthlyUsage
}

/// The usage last read for one user, so a different identity never sees it.
struct AIUsageSnapshot: Hashable, Sendable {
    let userId: String
    let usage: AIMonthlyUsage
}

func aiChatRemainingMessagesNotice(usage: AIMonthlyUsage) -> String? {
    guard let remainingMessages = usage.remainingMessages,
          remainingMessages <= aiChatRemainingMessagesNoticeThreshold else {
        return nil
    }

    if remainingMessages == 1 {
        return aiSettingsLocalizedFormat(
            "ai.usage.remainingMessages.one",
            "%d AI message left this month",
            remainingMessages
        )
    }

    return aiSettingsLocalizedFormat(
        "ai.usage.remainingMessages.other",
        "%d AI messages left this month",
        remainingMessages
    )
}

func ownOpenAIKeyMonthMessagesText(ownKeyMessages: Int) -> String {
    if ownKeyMessages == 1 {
        return aiSettingsLocalizedFormat(
            "settings.ownOpenAIKey.monthMessages.one",
            "This month with your key: %d message",
            ownKeyMessages
        )
    }

    return aiSettingsLocalizedFormat(
        "settings.ownOpenAIKey.monthMessages.other",
        "This month with your key: %d messages",
        ownKeyMessages
    )
}
