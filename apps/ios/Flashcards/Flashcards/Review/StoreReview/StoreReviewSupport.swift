import Foundation

let lastStoreReviewRequestedAtUserDefaultsKey: String = "last-store-review-requested-at"
let lastStoreReviewRequestedAppVersionUserDefaultsKey: String = "last-store-review-requested-app-version"

enum StoreReviewEligibilityError: LocalizedError {
    case nextLocalDayUnavailable(Date)
    case invalidStoredLastRequestedAt(String)
    case invalidStoredLastRequestedAppVersion(String)
    case emptyStoredLastRequestedAppVersion

    var errorDescription: String? {
        switch self {
        case .nextLocalDayUnavailable(let date):
            return "Store review local day boundary could not be calculated for \(formatIsoTimestamp(date: date))"
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

struct StoreReviewRequestAttempt: Identifiable, Hashable, Sendable {
    let id: String
    let appVersion: String
    let requestedAt: Date
    let reviewPromptConfigVersion: String
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
