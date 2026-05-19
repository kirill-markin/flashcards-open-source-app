import Foundation
import OSLog

enum SentryObservabilityAdapter {
    static let state: LockedSentryObservabilityState = LockedSentryObservabilityState(isStarted: false)
    static let cloudLogger: Logger = Logger(
        subsystem: appBundleIdentifier(),
        category: "cloud"
    )
    static let observabilityLogger: Logger = Logger(
        subsystem: appBundleIdentifier(),
        category: "observability"
    )
}

final class LockedSentryObservabilityState: @unchecked Sendable {
    private let lock: NSLock
    private var started: Bool

    init(isStarted: Bool) {
        self.lock = NSLock()
        self.started = isStarted
    }

    func setIsStarted(_ isStarted: Bool) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.started = isStarted
    }

    func isStarted() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.started
    }
}
