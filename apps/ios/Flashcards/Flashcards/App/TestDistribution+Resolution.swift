import Foundation
import OSLog
import StoreKit

private let testDistributionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "test_distribution"
)

extension TestDistribution {
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
        Self.store(isTestDistribution: isTestDistribution)
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
