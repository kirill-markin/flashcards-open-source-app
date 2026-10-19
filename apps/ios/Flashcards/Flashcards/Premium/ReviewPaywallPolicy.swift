import Foundation

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
    let lastShownAt: String?

    static let empty = PaywallState(
        introShownAt: nil, introLocalDate: nil, introTimeZone: nil,
        followUpShownAt: nil, lastShownAt: nil
    )

    func merging(_ other: PaywallState) -> PaywallState {
        let intro = earlierPaywallTimestamp(self.introShownAt, other.introShownAt)
        let introState = intro == self.introShownAt ? self : other
        return PaywallState(
            introShownAt: intro,
            introLocalDate: introState.introLocalDate,
            introTimeZone: introState.introTimeZone,
            followUpShownAt: earlierPaywallTimestamp(self.followUpShownAt, other.followUpShownAt),
            lastShownAt: laterPaywallTimestamp(self.lastShownAt, other.lastShownAt)
        )
    }

    func recording(_ impression: PaywallShownRequest) -> PaywallState {
        self.merging(PaywallState(
            introShownAt: impression.reviewTrigger == .initial ? impression.shownAt : nil,
            introLocalDate: impression.reviewTrigger == .initial ? impression.localDate : nil,
            introTimeZone: impression.reviewTrigger == .initial ? impression.timeZone : nil,
            followUpShownAt: impression.reviewTrigger == .day3 ? impression.shownAt : nil,
            lastShownAt: impression.shownAt
        ))
    }

    func validated() throws -> PaywallState {
        for timestamp in [self.introShownAt, self.followUpShownAt, self.lastShownAt].compactMap({ $0 }) {
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
    let reviewCount: Int
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

func dueReviewPaywallTrigger(
    state: PaywallState,
    entitlement: CloudEntitlement?,
    cumulativeReviews: Int,
    reviewsToday: Int,
    now: Date,
    timeZone: TimeZone
) -> ReviewPaywallTrigger? {
    guard let entitlement, entitlement.tierRank < premiumTierRank,
          entitlement.status == .noEntitlement, entitlement.isTrial == false else { return nil }
    guard let introLocalDate = state.introLocalDate else {
        return cumulativeReviews >= 3 ? .initial : nil
    }
    guard reviewsToday >= 2 else { return nil }
    if state.followUpShownAt == nil {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .gmt
        formatter.dateFormat = "yyyy-MM-dd"
        guard let introDate = formatter.date(from: introLocalDate),
              let dueDate = formatter.calendar.date(byAdding: .day, value: 2, to: introDate) else { return nil }
        return paywallLocalDate(now: now, timeZone: timeZone) >= formatter.string(from: dueDate) ? .day3 : nil
    }
    guard let lastShownAt = state.lastShownAt, let lastShown = parseIsoTimestamp(value: lastShownAt),
          now.timeIntervalSince(lastShown) >= 7 * 24 * 60 * 60 else { return nil }
    return .weekly
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
        case introShownAt, introLocalDate, introTimeZone, followUpShownAt, lastShownAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.introShownAt = try container.decode(String?.self, forKey: .introShownAt)
        self.introLocalDate = try container.decode(String?.self, forKey: .introLocalDate)
        self.introTimeZone = try container.decode(String?.self, forKey: .introTimeZone)
        self.followUpShownAt = try container.decode(String?.self, forKey: .followUpShownAt)
        self.lastShownAt = try container.decode(String?.self, forKey: .lastShownAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.introShownAt, forKey: .introShownAt)
        try container.encode(self.introLocalDate, forKey: .introLocalDate)
        try container.encode(self.introTimeZone, forKey: .introTimeZone)
        try container.encode(self.followUpShownAt, forKey: .followUpShownAt)
        try container.encode(self.lastShownAt, forKey: .lastShownAt)
    }
}
