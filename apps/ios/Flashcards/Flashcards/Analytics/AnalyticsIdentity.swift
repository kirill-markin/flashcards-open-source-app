import Foundation

let analyticsAnonymousIdUserDefaultsKey: String = "analytics-anonymous-id"
let analyticsSessionIdUserDefaultsKey: String = "analytics-session-id"
let analyticsSessionLastEventAtUserDefaultsKey: String = "analytics-session-last-event-at"

struct AnalyticsIdentitySnapshot: Sendable, Equatable {
    let anonymousId: String
    let sessionId: String
}

/**
 * `anonymous_id` and `session_id` lifecycle.
 *
 * `anonymous_id` lives in `UserDefaults` and deliberately not in the Keychain: the Keychain would
 * carry it across a reinstall, and identity resolution in `analytics.identity_links` is
 * first-link-wins with no repair path, so a resurrected id would silently merge two people forever.
 * For the same reason it is not the sync installation id, which must stay stable across users while
 * this must reset so a second person on a shared device does not inherit the first person's identity.
 *
 * It is also the **durable marker of the identity boundary**. Every queued row is stamped with the id
 * it was written under, and rotating this value is the first thing `reset()` does, so a row created
 * before a boundary is recognisable as such by comparing two persisted facts. Nothing in memory has
 * to survive for that comparison to hold.
 *
 * `session_id` is a UUID that rotates after 30 minutes with no emitted analytics event, foreground
 * and background alike. The rule is stated as inactivity rather than backgrounding on purpose, so
 * session counts stay comparable with web and Android.
 *
 * Read on the interaction path by `track` and again on the analytics actor, so the read-modify-write
 * pairs are held under a lock rather than left to `UserDefaults` key-at-a-time atomicity.
 */
final class AnalyticsIdentity: @unchecked Sendable {
    private let lock: NSLock
    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults) {
        self.lock = NSLock()
        self.userDefaults = userDefaults
    }

    /// The persisted `anonymous_id` on its own, without touching the session. This is the value every
    /// queued row carries and the value a batch is checked against before it is sent.
    func currentAnonymousId() -> String {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.loadOrCreateAnonymousIdLocked()
    }

    /**
     * Resolves the identity for an event that is being emitted now, rotating the session first when it
     * has gone stale, and then recording this emission as the session's latest activity.
     *
     * `requiredAnonymousId` is the id read when the event was created. Checking it here, under the same
     * lock that reads the persisted value, is what keeps an event created before an identity boundary
     * from being stamped with the identity of whoever comes next merely because its queue write was
     * scheduled after the boundary. A mismatch returns `nil` and the event is discarded.
     */
    func identityForEmittedEvent(now: Date, requiredAnonymousId: String) -> AnalyticsIdentitySnapshot? {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        let anonymousId = self.loadOrCreateAnonymousIdLocked()
        guard anonymousId == requiredAnonymousId else {
            return nil
        }

        let lastEventAt = self.userDefaults.object(
            forKey: analyticsSessionLastEventAtUserDefaultsKey
        ) as? Double
        let sessionId = self.loadOrCreateSessionIdLocked(now: now, lastEventAt: lastEventAt)
        // Clamped forward. `track` hands every event to an independently scheduled job, so two events
        // created microseconds apart can arrive here in reverse creation order, and letting the earlier
        // one rewind the marker would shorten the inactivity window for everything after it.
        self.userDefaults.set(
            max(now.timeIntervalSince1970, lastEventAt ?? now.timeIntervalSince1970),
            forKey: analyticsSessionLastEventAtUserDefaultsKey
        )
        return AnalyticsIdentitySnapshot(anonymousId: anonymousId, sessionId: sessionId)
    }

    /**
     * Explicit logout. The anonymous id rotates here and nowhere else.
     *
     * This rotation **is** the identity boundary. It runs synchronously on the caller's thread, before
     * any queue work is scheduled, and it lands in `UserDefaults` — a different store with a different
     * failure mode from the queue's SQLite file. Everything downstream compares a row's stored id with
     * this one, so neither a failed queue wipe nor a process death between the two can leave a
     * pre-boundary row that looks current. `synchronize()` is called deliberately rather than left to
     * the periodic flush: the marker has to be on disk before a kill that the rows it guards outlive.
     */
    func reset() {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        self.userDefaults.set(makeAnalyticsAnonymousId(), forKey: analyticsAnonymousIdUserDefaultsKey)
        self.userDefaults.removeObject(forKey: analyticsSessionIdUserDefaultsKey)
        self.userDefaults.removeObject(forKey: analyticsSessionLastEventAtUserDefaultsKey)
        _ = self.userDefaults.synchronize()
    }

    private func loadOrCreateAnonymousIdLocked() -> String {
        if let storedAnonymousId = self.userDefaults.string(forKey: analyticsAnonymousIdUserDefaultsKey),
           isAnalyticsUuidString(value: storedAnonymousId) {
            return storedAnonymousId
        }

        let anonymousId = makeAnalyticsAnonymousId()
        self.userDefaults.set(anonymousId, forKey: analyticsAnonymousIdUserDefaultsKey)
        return anonymousId
    }

    private func loadOrCreateSessionIdLocked(now: Date, lastEventAt: Double?) -> String {
        let storedSessionId = self.userDefaults.string(forKey: analyticsSessionIdUserDefaultsKey)

        if let storedSessionId,
           isAnalyticsUuidString(value: storedSessionId),
           let lastEventAt,
           // Signed, not absolute, and the contract settles it this way for all three clients. A
           // session is a statement about user activity, so only real inactivity — the marker falling
           // more than the timeout *behind* now — may rotate it. Any `now` at or before the marker
           // keeps the session, which covers both cases that produce one: `track` gives no ordering
           // between events, so an event created microseconds earlier can arrive after a later one;
           // and a backwards clock correction must not mint sessions at all. An `abs()` here would
           // rotate on every event after a >30-minute backwards jump, because the forward clamp the
           // caller applies pins the marker to the stale future value until wall time catches up —
           // one session per event for the size of the jump.
           now.timeIntervalSince1970 - lastEventAt < analyticsSessionTimeoutSeconds {
            return storedSessionId
        }

        let sessionId = makeAnalyticsSessionId()
        self.userDefaults.set(sessionId, forKey: analyticsSessionIdUserDefaultsKey)
        return sessionId
    }
}

/// `anonymousId` and `sessionId` carry no UUID version requirement; only `eventId` does.
func makeAnalyticsAnonymousId() -> String {
    UUID().uuidString.lowercased()
}

func makeAnalyticsSessionId() -> String {
    UUID().uuidString.lowercased()
}

/**
 * `eventId` must be a UUID **version 7**. `UUID()` produces version 4, and the endpoint reports a
 * version 4 id as the generic `invalid_event`, indistinguishable from a malformed event, so getting
 * this wrong is silent on the client. Version 7 is generated explicitly here: a 48-bit big-endian
 * millisecond timestamp, the version nibble, the RFC 9562 variant bits, and random elsewhere.
 */
func makeAnalyticsEventId(now: Date = Date()) -> String {
    var randomBytes = [UInt8](repeating: 0, count: 10)
    for index in randomBytes.indices {
        randomBytes[index] = UInt8.random(in: UInt8.min...UInt8.max)
    }

    let eventId = makeAnalyticsUuidV7(
        millisecondsSince1970: epochMillis(date: now),
        randomBytes: randomBytes
    )
    // The rule the server actually applies, checked against the produced string rather than against
    // the code that produced it. A version 4 id comes back as the generic `invalid_event`, so a
    // regression here would silently cost every event the client sends; debug builds trap instead,
    // which includes the simulator smoke run.
    assert(isAnalyticsUuidV7(value: eventId), "Analytics event ids must be UUID version 7")
    return eventId
}

func makeAnalyticsUuidV7(millisecondsSince1970: Int64, randomBytes: [UInt8]) -> String {
    precondition(randomBytes.count >= 10, "UUIDv7 needs 10 random bytes")

    let timestamp = UInt64(max(0, millisecondsSince1970)) & 0x0000_FFFF_FFFF_FFFF
    var bytes = [UInt8](repeating: 0, count: 16)
    bytes[0] = UInt8((timestamp >> 40) & 0xFF)
    bytes[1] = UInt8((timestamp >> 32) & 0xFF)
    bytes[2] = UInt8((timestamp >> 24) & 0xFF)
    bytes[3] = UInt8((timestamp >> 16) & 0xFF)
    bytes[4] = UInt8((timestamp >> 8) & 0xFF)
    bytes[5] = UInt8(timestamp & 0xFF)
    // High nibble of byte 6 is the version, and it is character 14 of the canonical string, which is
    // exactly what the server checks.
    bytes[6] = 0x70 | (randomBytes[0] & 0x0F)
    bytes[7] = randomBytes[1]
    // Two high bits of byte 8 are the variant.
    bytes[8] = 0x80 | (randomBytes[2] & 0x3F)
    for index in 0..<7 {
        bytes[9 + index] = randomBytes[3 + index]
    }

    return canonicalAnalyticsUuidString(bytes: bytes)
}

func isAnalyticsUuidV7(value: String) -> Bool {
    guard isAnalyticsUuidString(value: value) else {
        return false
    }

    return Array(value)[14] == "7"
}

func isAnalyticsUuidString(value: String) -> Bool {
    let characters = Array(value.utf8)
    guard characters.count == 36 else {
        return false
    }

    let hyphenIndexes: Set<Int> = [8, 13, 18, 23]
    for (index, byte) in characters.enumerated() {
        if hyphenIndexes.contains(index) {
            guard byte == 45 else {
                return false
            }
            continue
        }

        let isDigit = byte >= 48 && byte <= 57
        let isLowercaseHex = byte >= 97 && byte <= 102
        guard isDigit || isLowercaseHex else {
            return false
        }
    }

    return true
}

private func canonicalAnalyticsUuidString(bytes: [UInt8]) -> String {
    let hexDigits = Array("0123456789abcdef")
    var characters: [Character] = []
    characters.reserveCapacity(36)
    for (index, byte) in bytes.enumerated() {
        if index == 4 || index == 6 || index == 8 || index == 10 {
            characters.append("-")
        }
        characters.append(hexDigits[Int(byte >> 4)])
        characters.append(hexDigits[Int(byte & 0x0F)])
    }

    return String(characters)
}
