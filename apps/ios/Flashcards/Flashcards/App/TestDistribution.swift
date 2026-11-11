import Foundation

/// Written once by the launch resolution and read by sync from any isolation.
private final class TestDistributionState: @unchecked Sendable {
    private let lock: NSLock
    private var isTestDistribution: Bool

    init() {
        self.lock = NSLock()
        self.isTestDistribution = false
    }

    func current() -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.isTestDistribution
    }

    func store(isTestDistribution: Bool) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.isTestDistribution = isTestDistribution
    }
}

enum TestDistribution {
    private static let state: TestDistributionState = TestDistributionState()

    /// `true` when this install did not come from the App Store (TestFlight, App Review or a developer
    /// build). `false` until the launch resolution finishes, and for the whole process if it fails;
    /// sync's installation marker is sticky, so a later `true` still marks the installation.
    static var isTestDistribution: Bool {
        Self.state.current()
    }

    static func store(isTestDistribution: Bool) {
        Self.state.store(isTestDistribution: isTestDistribution)
    }
}
