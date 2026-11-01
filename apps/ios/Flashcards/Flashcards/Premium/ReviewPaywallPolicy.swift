import Foundation

// Wire names: day3 is paywall-second and weekly is paywall-periodic; see apps/backend/src/paywallState.ts.
enum ReviewPaywallTrigger: String, Codable, Sendable {
    case initial
    case day3
    case weekly
}

struct PaywallState: Codable, Equatable {
    let introShownAt: String?
    let introLocalDate: String?
    let introTimeZone: String?
    let followUpShownAt: String?
    let periodicShownAt: String?

    static let empty = PaywallState(
        introShownAt: nil, introLocalDate: nil, introTimeZone: nil,
        followUpShownAt: nil, periodicShownAt: nil
    )

    func merging(_ other: PaywallState) -> PaywallState {
        let intro = earlierPaywallTimestamp(self.introShownAt, other.introShownAt)
        let introState = intro == self.introShownAt ? self : other
        return PaywallState(
            introShownAt: intro,
            introLocalDate: introState.introLocalDate,
            introTimeZone: introState.introTimeZone,
            followUpShownAt: earlierPaywallTimestamp(self.followUpShownAt, other.followUpShownAt),
            periodicShownAt: laterPaywallTimestamp(self.periodicShownAt, other.periodicShownAt)
        )
    }

    func recording(_ impression: PaywallShownRequest) -> PaywallState {
        self.merging(PaywallState(
            introShownAt: impression.reviewTrigger == .initial ? impression.shownAt : nil,
            introLocalDate: impression.reviewTrigger == .initial ? impression.localDate : nil,
            introTimeZone: impression.reviewTrigger == .initial ? impression.timeZone : nil,
            followUpShownAt: impression.reviewTrigger == .day3 ? impression.shownAt : nil,
            periodicShownAt: impression.reviewTrigger == .weekly ? impression.shownAt : nil
        ))
    }

    func validated() throws -> PaywallState {
        for timestamp in [self.introShownAt, self.followUpShownAt, self.periodicShownAt].compactMap({ $0 }) {
            guard parseIsoTimestamp(value: timestamp) != nil else {
                throw LocalStoreError.validation("Invalid paywall-state timestamp: \(timestamp)")
            }
        }
        if let introShownAt = self.introShownAt {
            guard let date = parseIsoTimestamp(value: introShownAt),
                  let timeZoneName = self.introTimeZone, let timeZone = TimeZone(identifier: timeZoneName),
                  self.introLocalDate == paywallLocalDate(now: date, timeZone: timeZone) else {
                throw LocalStoreError.validation("Paywall-state intro date and timezone do not match its timestamp")
            }
        } else if self.introLocalDate != nil || self.introTimeZone != nil {
            throw LocalStoreError.validation("Paywall-state intro date requires an intro timestamp")
        }
        return self
    }
}

struct PaywallShownRequest: Codable, Equatable {
    let presentationId: UUID
    let shownAt: String
    let localDate: String
    let timeZone: String
    let reviewTrigger: ReviewPaywallTrigger?

    enum CodingKeys: String, CodingKey {
        case presentationId, shownAt, localDate, timeZone, reviewTrigger
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.presentationId, forKey: .presentationId)
        try container.encode(self.shownAt, forKey: .shownAt)
        try container.encode(self.localDate, forKey: .localDate)
        try container.encode(self.timeZone, forKey: .timeZone)
        try container.encode(self.reviewTrigger, forKey: .reviewTrigger)
    }
}

struct SavedReviewPromptOpportunity: Equatable {
    let id: UUID
    let workspaceId: String
    let rating: ReviewRating
    let reviewFilter: ReviewFilter
}

func paywallLocalDate(now: Date, timeZone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: now)
}

/// `state` must belong to a free account. Every review paywall's cooldown counts from the latest
/// after-review showing of any of the three; paywalls opened anywhere else do not count.
func reviewPaywallTriggerIsDue(
    trigger: ReviewPaywallTrigger,
    state: PaywallState,
    settings: ReviewPromptSettings,
    counters: ReviewPromptCounters,
    now: Date
) -> Bool {
    let lastShownAt = [state.introShownAt, state.followUpShownAt, state.periodicShownAt]
        .compactMap { shownAt in shownAt.flatMap { parseIsoTimestamp(value: $0) } }
        .max()
    switch trigger {
    case .initial:
        return state.introShownAt == nil
            && reviewPromptConfigAllows(settings: settings, counters: counters, lastShownAt: lastShownAt, now: now)
    case .day3:
        return state.followUpShownAt == nil
            && reviewPromptConfigAllows(settings: settings, counters: counters, lastShownAt: lastShownAt, now: now)
    case .weekly:
        return reviewPromptConfigAllows(settings: settings, counters: counters, lastShownAt: lastShownAt, now: now)
    }
}

private func earlierPaywallTimestamp(_ first: String?, _ second: String?) -> String? {
    guard let first else { return second }
    guard let second else { return first }
    guard let firstDate = parseIsoTimestamp(value: first), let secondDate = parseIsoTimestamp(value: second) else {
        return first
    }
    return firstDate <= secondDate ? first : second
}

private func laterPaywallTimestamp(_ first: String?, _ second: String?) -> String? {
    guard let first else { return second }
    guard let second else { return first }
    guard let firstDate = parseIsoTimestamp(value: first), let secondDate = parseIsoTimestamp(value: second) else {
        return first
    }
    return firstDate >= secondDate ? first : second
}


extension PaywallState {
    enum CodingKeys: String, CodingKey {
        case introShownAt, introLocalDate, introTimeZone, followUpShownAt, periodicShownAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.introShownAt = try container.decode(String?.self, forKey: .introShownAt)
        self.introLocalDate = try container.decode(String?.self, forKey: .introLocalDate)
        self.introTimeZone = try container.decode(String?.self, forKey: .introTimeZone)
        self.followUpShownAt = try container.decode(String?.self, forKey: .followUpShownAt)
        // Absent only from states cached before the server sent it; the next server merge fills it.
        self.periodicShownAt = try container.decodeIfPresent(String.self, forKey: .periodicShownAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.introShownAt, forKey: .introShownAt)
        try container.encode(self.introLocalDate, forKey: .introLocalDate)
        try container.encode(self.introTimeZone, forKey: .introTimeZone)
        try container.encode(self.followUpShownAt, forKey: .followUpShownAt)
        try container.encode(self.periodicShownAt, forKey: .periodicShownAt)
    }
}
