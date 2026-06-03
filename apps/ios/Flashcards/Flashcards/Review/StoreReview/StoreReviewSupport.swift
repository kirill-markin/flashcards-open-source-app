import Foundation

let lastStoreReviewRequestedAtUserDefaultsKey: String = "last-store-review-requested-at"
let lastStoreReviewRequestedAppVersionUserDefaultsKey: String = "last-store-review-requested-app-version"
let storeReviewMinimumCurrentDayReviewCount: Int = 5
let storeReviewAttemptCooldownCalendarDays: Int = 90
let storeReviewRequestedAnalyticsEventName: String = "store_review_requested"

enum StoreReviewEligibilityError: LocalizedError {
    case nextLocalDayUnavailable(Date)
    case cooldownIntervalUnavailable(Date, Date)
    case invalidStoredLastRequestedAt(String)
    case invalidStoredLastRequestedAppVersion(String)
    case emptyStoredLastRequestedAppVersion

    var errorDescription: String? {
        switch self {
        case .nextLocalDayUnavailable(let date):
            return "Store review local day boundary could not be calculated for \(formatIsoTimestamp(date: date))"
        case .cooldownIntervalUnavailable(let lastRequestedAt, let now):
            return "Store review cooldown interval could not be calculated from \(formatIsoTimestamp(date: lastRequestedAt)) to \(formatIsoTimestamp(date: now))"
        case .invalidStoredLastRequestedAt(let typeDescription):
            return "Stored Store review requested timestamp has unsupported type: \(typeDescription)"
        case .invalidStoredLastRequestedAppVersion(let typeDescription):
            return "Stored Store review requested app version has unsupported type: \(typeDescription)"
        case .emptyStoredLastRequestedAppVersion:
            return "Stored Store review requested app version must not be empty"
        }
    }
}

struct StoreReviewPromptState {
    let lastStoreReviewRequestedAt: Date?
    let lastStoreReviewRequestedAppVersion: String?
}

struct StoreReviewEligibilityContext {
    let hasReviewActivityOnPreviousLocalDay: Bool
    let currentLocalDayCompletedReviewCount: Int
    let currentAppVersion: String
    let now: Date
    let localCalendar: Calendar
    let promptState: StoreReviewPromptState
}

enum StoreReviewAnalyticsPlatform: String, Hashable, Sendable {
    case ios
}

struct StoreReviewRequestedAnalyticsEvent: Hashable, Sendable {
    let name: String
    let platform: StoreReviewAnalyticsPlatform
    let appVersion: String
    let localTimestamp: Date
    let installationId: String?
}

struct StoreReviewRequestAttempt: Identifiable, Hashable, Sendable {
    let id: String
    let appVersion: String
    let requestedAt: Date
    let installationId: String?
}

struct StoreReviewLocalDayRange: Hashable, Sendable {
    let start: Date
    let end: Date
}

func makeStoreReviewLocalCalendar(timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    return calendar
}

func makeStoreReviewCurrentLocalDayRange(now: Date, calendar: Calendar) throws -> StoreReviewLocalDayRange {
    let startOfToday = calendar.startOfDay(for: now)
    guard let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
        throw StoreReviewEligibilityError.nextLocalDayUnavailable(now)
    }

    return StoreReviewLocalDayRange(start: startOfToday, end: startOfTomorrow)
}

func loadStoreReviewPromptState(userDefaults: UserDefaults) throws -> StoreReviewPromptState {
    StoreReviewPromptState(
        lastStoreReviewRequestedAt: try loadLastStoreReviewRequestedAt(userDefaults: userDefaults),
        lastStoreReviewRequestedAppVersion: try loadLastStoreReviewRequestedAppVersion(userDefaults: userDefaults)
    )
}

func persistStoreReviewPromptState(userDefaults: UserDefaults, promptState: StoreReviewPromptState) {
    if let lastStoreReviewRequestedAt = promptState.lastStoreReviewRequestedAt {
        userDefaults.set(lastStoreReviewRequestedAt.timeIntervalSince1970, forKey: lastStoreReviewRequestedAtUserDefaultsKey)
    } else {
        userDefaults.removeObject(forKey: lastStoreReviewRequestedAtUserDefaultsKey)
    }

    if let lastStoreReviewRequestedAppVersion = promptState.lastStoreReviewRequestedAppVersion {
        userDefaults.set(lastStoreReviewRequestedAppVersion, forKey: lastStoreReviewRequestedAppVersionUserDefaultsKey)
    } else {
        userDefaults.removeObject(forKey: lastStoreReviewRequestedAppVersionUserDefaultsKey)
    }
}

func clearStoreReviewPromptState(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: lastStoreReviewRequestedAtUserDefaultsKey)
    userDefaults.removeObject(forKey: lastStoreReviewRequestedAppVersionUserDefaultsKey)
}

func shouldRequestStoreReview(context: StoreReviewEligibilityContext) throws -> Bool {
    guard context.hasReviewActivityOnPreviousLocalDay else {
        return false
    }
    guard context.currentLocalDayCompletedReviewCount >= storeReviewMinimumCurrentDayReviewCount else {
        return false
    }
    guard context.promptState.lastStoreReviewRequestedAppVersion != context.currentAppVersion else {
        return false
    }

    return try storeReviewAttemptCooldownHasElapsed(
        lastRequestedAt: context.promptState.lastStoreReviewRequestedAt,
        now: context.now,
        calendar: context.localCalendar
    )
}

func makeStoreReviewRequestedAnalyticsEvent(
    appVersion: String,
    localTimestamp: Date,
    installationId: String?
) -> StoreReviewRequestedAnalyticsEvent {
    StoreReviewRequestedAnalyticsEvent(
        name: storeReviewRequestedAnalyticsEventName,
        platform: .ios,
        appVersion: appVersion,
        localTimestamp: localTimestamp,
        installationId: installationId
    )
}

func fireAndForgetStoreReviewRequestedAnalyticsEvent(event: StoreReviewRequestedAnalyticsEvent) {
    _ = event
}

private func loadLastStoreReviewRequestedAt(userDefaults: UserDefaults) throws -> Date? {
    guard let rawValue = userDefaults.object(forKey: lastStoreReviewRequestedAtUserDefaultsKey) else {
        return nil
    }

    if let timestamp = rawValue as? TimeInterval {
        return Date(timeIntervalSince1970: timestamp)
    }

    throw StoreReviewEligibilityError.invalidStoredLastRequestedAt(String(describing: type(of: rawValue)))
}

private func loadLastStoreReviewRequestedAppVersion(userDefaults: UserDefaults) throws -> String? {
    guard let rawValue = userDefaults.object(forKey: lastStoreReviewRequestedAppVersionUserDefaultsKey) else {
        return nil
    }

    guard let appVersion = rawValue as? String else {
        throw StoreReviewEligibilityError.invalidStoredLastRequestedAppVersion(String(describing: type(of: rawValue)))
    }

    let trimmedAppVersion = appVersion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedAppVersion.isEmpty == false else {
        throw StoreReviewEligibilityError.emptyStoredLastRequestedAppVersion
    }

    return trimmedAppVersion
}

private func storeReviewAttemptCooldownHasElapsed(
    lastRequestedAt: Date?,
    now: Date,
    calendar: Calendar
) throws -> Bool {
    guard let lastRequestedAt else {
        return true
    }

    let lastRequestedLocalDay = calendar.startOfDay(for: lastRequestedAt)
    let currentLocalDay = calendar.startOfDay(for: now)
    let elapsedDays = calendar.dateComponents([.day], from: lastRequestedLocalDay, to: currentLocalDay).day
    guard let elapsedDays else {
        throw StoreReviewEligibilityError.cooldownIntervalUnavailable(lastRequestedAt, now)
    }

    return elapsedDays >= storeReviewAttemptCooldownCalendarDays
}
