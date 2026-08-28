import Foundation

/**
 * Hand-written mirror of the backend product analytics catalog in
 * `apps/backend/src/productAnalytics/catalog.ts`. The server rejects anything it does not declare,
 * so the client API is type-strict per event: every case carries exactly the properties the catalog
 * declares and there is deliberately no `track(name:properties:)` anywhere. A typo or an undeclared
 * property does not compile instead of becoming a silent server-side rejection.
 *
 * That strictness covers event names and properties, and no longer covers every enum value here:
 * `AnalyticsSurface` still declares `onboarding`, which the catalog dropped, so an event carrying
 * it as its `screen` compiles and is rejected `invalid_event`. No call site uses that value, and
 * until the enum drops it a value in this file is not on its own proof that the server accepts it.
 *
 * `guest_upgrade_completed` and `catalog_deck_installed` are server-derived and are absent here on
 * purpose: a client batch that carries one is rejected `server_only_event`.
 *
 * `onboarding_step_completed`, `review_session_started` and `review_session_ended` were removed
 * from the catalog outright, so the server no longer declares them and rejects them as unknown
 * event names.
 */
enum AnalyticsEvent: Sendable, Equatable {
    case appOpened(launchType: AnalyticsLaunchType)
    case screenViewed(screen: AnalyticsSurface)
    case signInFailed(reason: AnalyticsSignInFailureReason)
    case reviewAnswerFailed(reason: AnalyticsReviewAnswerFailureReason)
    case cardCreateStarted(entryPoint: AnalyticsCardCreateEntryPoint)
    /// Emit only through `Analytics.reportSyncFailure(reason:)`. Sync is retried on a timer, so a
    /// direct `track` measures poll cadence instead of failure incidence.
    case syncFailed(reason: AnalyticsSyncFailureReason)
    case catalogDeckInstallStarted(packageSlug: String)
    case analyticsEventsDropped(reason: AnalyticsDroppedReason, count: Int)
}

/**
 * Platform-independent surfaces from the backend catalog. Native screens are mapped onto these and a
 * native screen name is never sent, because cross-client funnel comparison is the only reason the
 * surface list is shared at all.
 */
enum AnalyticsSurface: String, Sendable, Equatable, CaseIterable {
    case review
    case catalog
    case deckDetail = "deck_detail"
    case onboarding
    case cardEditor = "card_editor"
    case cards
    case progress
    case settings
    case ai
}

/**
 * Captured when the event is created rather than when the batch flushes. A queued batch can only
 * ever be sent while online, so a flush-time reading could never record `offline`, which is the one
 * value the column exists for.
 */
enum AnalyticsNetworkState: String, Sendable, Equatable {
    case wifi
    case cellular
    case offline
    case unknown
}

enum AnalyticsLaunchType: String, Sendable, Equatable {
    case cold
    case warm
}

enum AnalyticsSignInFailureReason: String, Sendable, Equatable {
    case invalidCode = "invalid_code"
    case expiredCode = "expired_code"
    case rateLimited = "rate_limited"
    case offline
    case serverError = "server_error"
    case cancelled
}

enum AnalyticsReviewAnswerFailureReason: String, Sendable, Equatable {
    case offline
    case timeout
    case syncConflict = "sync_conflict"
    case serverError = "server_error"
}

enum AnalyticsCardCreateEntryPoint: String, Sendable, Equatable {
    case cards
    case deckDetail = "deck_detail"
    case review
    case ai
    case quickAction = "quick_action"
}

enum AnalyticsSyncFailureReason: String, Sendable, Equatable {
    case offline
    case timeout
    case conflict
    case unauthorized
    case serverError = "server_error"
    case storageFull = "storage_full"
}

/**
 * The catalog name of the loss-reporting event, needed by the delivery path: a refused
 * `analytics_events_dropped` must never be counted into a replacement, or the replacement is refused
 * for the same reason and the client posts forever without the queue ever changing.
 */
let analyticsEventsDroppedEventName: String = "analytics_events_dropped"

enum AnalyticsDroppedReason: String, Sendable, Equatable {
    case queueOverflow = "queue_overflow"
    case ttlExpired = "ttl_expired"
    case rejected
}

/// The only two property value kinds the catalog admits. Nested objects and arrays are rejected.
enum AnalyticsPropertyValue: Sendable, Equatable, Codable {
    case string(String)
    case integer(Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let integer = try? container.decode(Int.self) {
            self = .integer(integer)
            return
        }

        self = .string(try container.decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .integer(let value):
            try container.encode(value)
        }
    }
}

extension AnalyticsEvent {
    var eventName: String {
        switch self {
        case .appOpened:
            return "app_opened"
        case .screenViewed:
            return "screen_viewed"
        case .signInFailed:
            return "signin_failed"
        case .reviewAnswerFailed:
            return "review_answer_failed"
        case .cardCreateStarted:
            return "card_create_started"
        case .syncFailed:
            return "sync_failed"
        case .catalogDeckInstallStarted:
            return "catalog_deck_install_started"
        case .analyticsEventsDropped:
            return analyticsEventsDroppedEventName
        }
    }

    /**
     * `screen` is a top-level event field on the wire, never a property: a surface placed inside
     * `properties` is rejected `unknown_property`. Only `screen_viewed` carries one of its own; every
     * other event takes the surface the caller was on, if any.
     */
    var declaredScreen: AnalyticsSurface? {
        switch self {
        case .screenViewed(let screen):
            return screen
        default:
            return nil
        }
    }

    /**
     * Every declared property is required — the server builds a strict object with no optional
     * members — so each case fills in all of its own. Counters are clamped at zero because the
     * catalog admits no negative value and the table they land in is append-only.
     */
    var properties: [String: AnalyticsPropertyValue] {
        switch self {
        case .appOpened(let launchType):
            return ["launch_type": .string(launchType.rawValue)]
        case .screenViewed:
            return [:]
        case .signInFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .reviewAnswerFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .cardCreateStarted(let entryPoint):
            return ["entry_point": .string(entryPoint.rawValue)]
        case .syncFailed(let reason):
            return ["reason": .string(reason.rawValue)]
        case .catalogDeckInstallStarted(let packageSlug):
            return ["package_slug": .string(packageSlug)]
        case .analyticsEventsDropped(let reason, let count):
            return [
                "reason": .string(reason.rawValue),
                "count": .integer(max(0, count))
            ]
        }
    }

    /**
     * The one property the type system cannot pin down. A catalog package slug arrives from the
     * backend already in slug shape, so a value that fails the pattern is a caller bug; enqueuing it
     * would spend a queue slot on an event the server is guaranteed to reject.
     */
    var satisfiesCatalogValueConstraints: Bool {
        switch self {
        case .catalogDeckInstallStarted(let packageSlug):
            return isAnalyticsCatalogSlug(value: packageSlug)
        default:
            return true
        }
    }
}

/// Mirrors `productAnalyticsSlugPattern`: `^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$`.
func isAnalyticsCatalogSlug(value: String) -> Bool {
    let characters = Array(value.utf8)
    guard characters.count >= 1 && characters.count <= 120 else {
        return false
    }

    func isLowercaseAlphanumeric(_ byte: UInt8) -> Bool {
        (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57)
    }

    guard isLowercaseAlphanumeric(characters[0]) else {
        return false
    }
    guard characters.count > 1 else {
        return true
    }
    guard isLowercaseAlphanumeric(characters[characters.count - 1]) else {
        return false
    }

    for byte in characters[1..<(characters.count - 1)] {
        guard isLowercaseAlphanumeric(byte) || byte == 45 else {
            return false
        }
    }

    return true
}
