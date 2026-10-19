import Foundation
import OSLog
import StoreKit

private let testDistributionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "test_distribution"
)

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

    static func startResolution() {
        Task.detached(priority: .utility) {
            await Self.resolve()
        }
    }

    private static func resolve() async {
        let result: VerificationResult<AppTransaction>
        do {
            result = try await AppTransaction.shared
        } catch {
            testDistributionLogger.error(
                "event=test_distribution_resolution_failed error=\(String(describing: error), privacy: .public)"
            )
            return
        }

        let transaction: AppTransaction
        let isVerified: Bool
        switch result {
        case .verified(let verifiedTransaction):
            transaction = verifiedTransaction
            isVerified = true
        case .unverified(let unverifiedTransaction, let verificationError):
            // A developer build's transaction can fail verification and is still a test install.
            testDistributionLogger.error(
                "event=test_distribution_transaction_unverified error=\(String(describing: verificationError), privacy: .public)"
            )
            transaction = unverifiedTransaction
            isVerified = false
        }

        let isTestDistribution = transaction.environment != .production
        Self.state.store(isTestDistribution: isTestDistribution)
        testDistributionLogger.log(
            """
            event=test_distribution_decided \
            isTestDistribution=\(String(isTestDistribution), privacy: .public) \
            environment=\(transaction.environment.rawValue, privacy: .public) \
            isVerified=\(String(isVerified), privacy: .public)
            """
        )
    }
}
