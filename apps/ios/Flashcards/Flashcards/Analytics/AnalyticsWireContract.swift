import Foundation

/// `POST /v1/analytics/events`. The trailing-slash form answers 404 on purpose and also misses the
/// endpoint's tighter API Gateway throttle and all three of its alarms, so the final URL is asserted
/// rather than assembled by a base-URL join that might normalise one in.
let analyticsEventsPath: String = "/analytics/events"
let analyticsClientPlatformHeaderValue: String = "ios"

/// Shared behavioural constants. These are identical on web, iOS and Android by contract; changing
/// one here without changing it there makes the three clients incomparable in the data.
let analyticsSessionTimeoutSeconds: TimeInterval = 30 * 60
let analyticsFlushBatchThreshold: Int = 20
let analyticsMaximumEventsPerBatch: Int = 50
let analyticsQueueMaximumEventCount: Int = 5_000
let analyticsQueueMaximumByteCount: Int = 5 * 1_024 * 1_024
let analyticsQueueTimeToLiveSeconds: TimeInterval = 14 * 24 * 60 * 60
let analyticsPeriodicFlushIntervalSeconds: TimeInterval = 5 * 60
let analyticsRetryBaseDelaySeconds: TimeInterval = 2
let analyticsRetryMaximumDelaySeconds: TimeInterval = 60 * 60
/**
 * How long a pressed control waits for the queue to drain before it destroys the credential behind
 * it — the sign-out and the account deletion. On expiry the teardown goes ahead and whatever did not
 * leave is lost, which is the accepted direction: this table is append-only and has no repair path.
 *
 * Two seconds, and the same two seconds on web and Android, because the three clients have to count
 * the same way. Nothing that nobody pressed ever waits here, so this is a pure interaction budget
 * rather than a compromise with a background path: a person is looking at a spinner on the control
 * they just used, which is the range where a wait reads as work rather than as a hang. What has to
 * fit inside it is one round trip for one session's events — far below `analyticsMaximumEventsPerBatch`
 * — and a queue that needs longer is one that is offline or backed off, where no bound short enough
 * to put in front of a person would have delivered it either.
 */
let analyticsPressedControlDrainBoundSeconds: TimeInterval = 2

/**
 * How many flush passes one pressed-control drain may run, matching the web's
 * `identityTeardownFlushPassLimit`.
 *
 * One flush stops after `analyticsMaximumDrainIterationsPerFlush` batches, and this is the one
 * moment a remainder cannot be picked up by a later trigger. The first pass always runs, whatever
 * the flush before it did; after that the passes stop as soon as one ends for a reason another pass
 * would not improve on — an emptied queue, a deferral, a store failure — and continue only while a
 * pass keeps exhausting its own batch cap. That ordinarily means a pass settled every batch it sent
 * and stopped short of emptying the queue, but not always: `runFlush` counts an iteration that sent
 * nothing because the identity rotated under it, so a pass can exhaust the cap having delivered
 * nothing and still ask for another. The limit therefore bounds a queue that keeps making progress
 * and one that keeps failing this way, and the caller's two-second bound stops the waiting well
 * before either is a factor.
 */
let analyticsPressedControlDrainPassLimit: Int = 10

/**
 * How many batches one flush may post before it stops and waits for the next trigger.
 *
 * The contract requires a bound and leaves the number to each client. It exists because a batch
 * refused at the envelope level is dropped and reported as `analytics_events_dropped`, and that
 * report can be refused in turn: without a cap, one device off contract posts once per iteration
 * forever and can consume the endpoint's entire 20 rps method throttle for every other client.
 * Anything the cap leaves behind is picked up by the next trigger, so a real backlog still drains.
 */
let analyticsMaximumDrainIterationsPerFlush: Int = 25

/// Server-side per-event cap, measured as UTF-8 bytes of the event's own JSON.
let analyticsMaximumEventByteCount: Int = 4 * 1_024

struct AnalyticsEventPayload: Sendable, Equatable, Codable {
    let eventId: String
    let eventName: String
    let clientOccurredAt: String
    let networkState: String?
    // Synthesized decoding leaves pre-existing queued events without this field unknown.
    let uiLocale: String?
    let screen: String?
    let properties: [String: AnalyticsPropertyValue]?
    let experimentAssignments: [String: String]?

    private enum CodingKeys: String, CodingKey {
        case eventId
        case eventName
        case clientOccurredAt
        case networkState
        case uiLocale
        case screen
        case properties
        case experimentAssignments
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.eventId, forKey: .eventId)
        try container.encode(self.eventName, forKey: .eventName)
        try container.encode(self.clientOccurredAt, forKey: .clientOccurredAt)
        // `encode` rather than `encodeIfPresent`: an absent key and an explicit null are not the same
        // wire output, and the contract asks for the explicit null.
        try container.encode(self.networkState, forKey: .networkState)
        try container.encode(self.uiLocale, forKey: .uiLocale)
        try container.encode(self.screen, forKey: .screen)
        try container.encode(self.properties, forKey: .properties)
        try container.encode(self.experimentAssignments, forKey: .experimentAssignments)
    }
}

/// The batch envelope. The server parses it `.strict()`, so an unexpected top-level key fails the
/// whole request with 400.
struct AnalyticsBatchPayload: Sendable, Equatable, Encodable {
    let clientSentAt: String
    let anonymousId: String?
    let sessionId: String?
    let context: AnalyticsContextPayload?
    /// The same declaration the installation makes over sync, repeated because the two surfaces share
    /// no identifier. `true` makes the server answer for the batch and store none of it.
    let isAutomation: Bool
    let events: [AnalyticsEventPayload]

    private enum CodingKeys: String, CodingKey {
        case clientSentAt
        case anonymousId
        case sessionId
        case context
        case isAutomation
        case events
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.clientSentAt, forKey: .clientSentAt)
        try container.encode(self.anonymousId, forKey: .anonymousId)
        try container.encode(self.sessionId, forKey: .sessionId)
        try container.encode(self.context, forKey: .context)
        try container.encode(self.isAutomation, forKey: .isAutomation)
        try container.encode(self.events, forKey: .events)
    }
}

struct AnalyticsContextPayload: Sendable, Equatable, Encodable {
    let osVersion: String?
    let deviceModel: String?
    let deviceLocale: String?
    let timezone: String?

    private enum CodingKeys: String, CodingKey {
        case osVersion
        case deviceModel
        case deviceLocale
        case timezone
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.osVersion, forKey: .osVersion)
        try container.encode(self.deviceModel, forKey: .deviceModel)
        try container.encode(self.deviceLocale, forKey: .deviceLocale)
        try container.encode(self.timezone, forKey: .timezone)
    }
}

/// `accepted` is a count only; no accepted ids come back. A client that waits for a list of accepted
/// ids before purging its queue never purges.
struct AnalyticsIngestResponse: Sendable, Equatable, Decodable {
    let accepted: Int
    let rejected: [AnalyticsRejectedEvent]
}

struct AnalyticsRejectedEvent: Sendable, Equatable, Decodable {
    let eventId: String?
    let reason: String
}

/**
 * UTC with a `Z` suffix, which is the only shape `z.string().datetime()` accepts: a timezone offset
 * fails, and `ISO8601DateFormatter` readily produces one when its time zone is not GMT. A bad
 * `clientSentAt` 400s the whole batch and a bad `clientOccurredAt` rejects that event as
 * `invalid_event`, so the produced string is checked rather than the formatter options.
 */
func analyticsTimestampString(date: Date) -> String {
    let formatted = formatIsoTimestamp(date: date)
    if formatted.hasSuffix("Z") {
        return formatted
    }

    return analyticsFallbackUtcTimestampString(date: date)
}

private func analyticsFallbackUtcTimestampString(date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    return formatter.string(from: date)
}
