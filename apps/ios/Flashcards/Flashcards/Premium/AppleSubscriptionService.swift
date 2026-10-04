import Foundation
import Observation
import StoreKit
import UIKit

private let applePremiumProductId: String = "premium_monthly"

enum AppleSubscriptionError: LocalizedError {
    case accountUnavailable
    case identityChanged
    case productUnavailable
    case attachmentNotConfirmed
    case entitlementNotConfirmed
    case premiumAlreadyAvailable
    case unexpectedPurchaseResult

    var errorDescription: String? {
        switch self {
        case .accountUnavailable:
            return "An authenticated guest or linked account is required for Apple subscriptions."
        case .identityChanged:
            return "The account changed during the Apple subscription operation. Retry from the current account."
        case .productUnavailable:
            return "The App Store did not return the premium_monthly subscription."
        case .attachmentNotConfirmed:
            return "The server did not confirm processing of the Apple transaction."
        case .entitlementNotConfirmed:
            return "The server did not return account access. Check your connection and retry."
        case .premiumAlreadyAvailable:
            return "Your account already has Premium access. No purchase is needed."
        case .unexpectedPurchaseResult:
            return "The App Store returned an unsupported purchase result."
        }
    }
}

struct AppleSubscriptionOffer {
    let product: Product
    let isEligibleForIntroOffer: Bool

    var displayPrice: String { self.product.displayPrice }
}

enum AppleSubscriptionPurchaseResult {
    case attached
    case pending
    case cancelled
}

private enum ApplePremiumStorePurchase {
    case verified(verification: VerificationResult<StoreKit.Transaction>, transaction: StoreKit.Transaction)
    case pending
    case cancelled

    var analyticsOutcome: AnalyticsPurchaseOutcome {
        switch self {
        case .verified:
            return .completed
        case .pending:
            return .pending
        case .cancelled:
            return .cancelled
        }
    }
}

@MainActor
@Observable
final class AppleSubscriptionService {
    private let store: FlashcardsStore
    private let transport: CloudSyncTransport
    @ObservationIgnored private var processing: [UInt64: (id: UUID, identity: AppleSubscriptionIdentity, intent: AppleBillingTransactionIntent, task: Task<Void, Error>)] = [:]

    @ObservationIgnored private var runtimeIdentity: AppleSubscriptionIdentity?
    @ObservationIgnored private var isRuntimeActive: Bool = false
    @ObservationIgnored private var updatesTask: Task<Void, Never>?
    @ObservationIgnored private var reconciliationTask: Task<Void, Never>?

    private(set) var confirmationRevision: Int = 0
    var runtimeErrorMessage: String?
    private var detailsIdentity: AppleSubscriptionIdentity?
    private var verifiedPurchases: [StoreKit.Transaction] = []

    var currentPurchases: [StoreKit.Transaction] {
        self.detailsIdentity == (try? self.store.appleSubscriptionIdentity()) ? self.verifiedPurchases : []
    }

    init(store: FlashcardsStore, session: URLSession) {
        self.store = store
        self.transport = CloudSyncTransport(session: session)
    }

    func updateRuntime(identity: AppleSubscriptionIdentity?, isActive: Bool) {
        guard self.runtimeIdentity != identity || self.isRuntimeActive != isActive else { return }
        if self.runtimeIdentity != identity {
            let previousUpdates = self.updatesTask
            previousUpdates?.cancel()
            self.runtimeIdentity = identity
            self.runtimeErrorMessage = nil
            self.updatesTask = Task { @MainActor in
                await previousUpdates?.value
                guard let identity else { return }
                do {
                    try self.store.requireAppleSubscriptionIdentity(identity)
                    try await self.consumeTransactionUpdates { error in
                        self.publishRuntimeError(error, identity: identity)
                    }
                } catch {
                    self.publishRuntimeError(error, identity: identity)
                }
            }
        }
        self.isRuntimeActive = isActive
        self.reconciliationTask?.cancel()
        guard isActive, let identity else { return }
        self.reconciliationTask = Task { @MainActor in
            do {
                try self.store.requireAppleSubscriptionIdentity(identity)
                try await self.reconcileCurrentEntitlements()
            } catch {
                self.publishRuntimeError(error, identity: identity)
            }
        }
    }

    private func publishRuntimeError(_ error: Error, identity: AppleSubscriptionIdentity) {
        guard Task.isCancelled == false, (try? self.store.appleSubscriptionIdentity()) == identity else { return }
        self.runtimeErrorMessage = error.localizedDescription
    }

    func loadOffer() async throws -> AppleSubscriptionOffer {
        guard let product = try await Product.products(for: [applePremiumProductId]).first,
              product.id == applePremiumProductId, product.type == .autoRenewable,
              let subscription = product.subscription else {
            throw AppleSubscriptionError.productUnavailable
        }
        return AppleSubscriptionOffer(
            product: product,
            isEligibleForIntroOffer: await subscription.isEligibleForIntroOffer
        )
    }

    func purchasePremium() async throws -> AppleSubscriptionPurchaseResult {
        let identity = try self.store.appleSubscriptionIdentity()
        let offer = try await self.loadOffer()
        let token = try await self.store.appleSubscriptionAccountToken(identity: identity, transport: self.transport)
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        try self.store.requireAppleSubscriptionIdentity(identity)
        guard let entitlement = self.store.cloudEntitlement else {
            throw AppleSubscriptionError.entitlementNotConfirmed
        }
        guard hasPremiumAccess(entitlement: entitlement) == false else {
            throw AppleSubscriptionError.premiumAlreadyAvailable
        }
        self.trackForCurrentIdentity(.purchaseStarted, identity: identity)
        let purchase: ApplePremiumStorePurchase
        do {
            purchase = try await self.storePurchase(product: offer.product, token: token)
        } catch {
            self.trackForCurrentIdentity(.purchaseFinished(outcome: .failed), identity: identity)
            throw error
        }
        self.trackForCurrentIdentity(.purchaseFinished(outcome: purchase.analyticsOutcome), identity: identity)
        try self.store.requireAppleSubscriptionIdentity(identity)
        switch purchase {
        case .pending:
            return .pending
        case .cancelled:
            return .cancelled
        case .verified(let verification, let transaction):
            try await self.attach(verification: verification, transaction: transaction, identity: identity, intent: .explicit)
            return .attached
        }
    }

    private func storePurchase(product: Product, token: UUID) async throws -> ApplePremiumStorePurchase {
        let result = try await product.purchase(options: [.appAccountToken(token)])
        switch result {
        case .pending:
            return .pending
        case .userCancelled:
            return .cancelled
        case .success(let verification):
            guard let transaction = try self.verifiedPremiumTransaction(verification),
                  transaction.appAccountToken == token else {
                throw AppleSubscriptionError.unexpectedPurchaseResult
            }
            return .verified(verification: verification, transaction: transaction)
        @unknown default:
            throw AppleSubscriptionError.unexpectedPurchaseResult
        }
    }

    func restorePurchases() async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        let hasRestoredPurchase: Bool
        do {
            hasRestoredPurchase = try await self.restorePremiumPurchases(identity: identity)
        } catch {
            self.trackForCurrentIdentity(.purchaseRestoreFinished(outcome: .failed), identity: identity)
            throw error
        }
        self.trackForCurrentIdentity(
            .purchaseRestoreFinished(outcome: hasRestoredPurchase ? .restored : .nothingToRestore),
            identity: identity
        )
    }

    /// Returns whether the App Store held a premium entitlement to restore.
    private func restorePremiumPurchases(identity: AppleSubscriptionIdentity) async throws -> Bool {
        try await AppStore.sync()
        try self.store.requireAppleSubscriptionIdentity(identity)
        var hasRestoredPurchase = false
        for await verification in StoreKit.Transaction.currentEntitlements {
            try self.store.requireAppleSubscriptionIdentity(identity)
            guard let transaction = try self.verifiedPremiumTransaction(verification) else { continue }
            hasRestoredPurchase = true
            // An explicit restore is the deliberate last-presenter-wins transfer path.
            try await self.attach(verification: verification, transaction: transaction, identity: identity, intent: .explicit)
        }
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        try await self.refreshPurchaseDetails(identity: identity)
        self.runtimeErrorMessage = nil
        return hasRestoredPurchase
    }

    /// An account that changed while the store sheet was open may already have rotated the analytics
    /// identity, so its outcome is dropped rather than risk filing it under the account that replaced it.
    private func trackForCurrentIdentity(_ event: AnalyticsEvent, identity: AppleSubscriptionIdentity) {
        guard (try? self.store.appleSubscriptionIdentity()) == identity else { return }
        Analytics.track(event, screen: analyticsSurface(tab: self.store.currentVisibleTab))
    }

    func reconcileCurrentEntitlements() async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        try await self.refreshPurchaseDetails(identity: identity)
        for await verification in StoreKit.Transaction.currentEntitlements {
            try await self.reconcileTransaction(verification, identity: identity)
        }
        // Revoked/expired unfinished transactions may be absent from currentEntitlements.
        for await verification in StoreKit.Transaction.unfinished {
            try await self.reconcileTransaction(verification, identity: identity)
        }
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        try await self.refreshPurchaseDetails(identity: identity)
        self.runtimeErrorMessage = nil
    }

    func consumeTransactionUpdates(onError: @MainActor (Error) -> Void) async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        for await verification in StoreKit.Transaction.updates {
            try self.store.requireAppleSubscriptionIdentity(identity)
            do {
                try await self.reconcileTransaction(verification, identity: identity)
            } catch {
                try self.store.requireAppleSubscriptionIdentity(identity)
                onError(error)
            }
        }
        try self.store.requireAppleSubscriptionIdentity(identity)
    }

    func manageSubscriptions(in scene: UIWindowScene) async throws {
        Analytics.track(
            .subscriptionManagementOpened(destination: .appStore),
            screen: analyticsSurface(tab: self.store.currentVisibleTab)
        )
        try await AppStore.showManageSubscriptions(in: scene)
    }

    func refreshPurchaseDetails(identity: AppleSubscriptionIdentity) async throws {
        var purchases: [StoreKit.Transaction] = []
        for await verification in StoreKit.Transaction.currentEntitlements {
            try self.store.requireAppleSubscriptionIdentity(identity)
            if let transaction = try self.verifiedPremiumTransaction(verification) {
                purchases.append(transaction)
            }
        }
        try self.store.requireAppleSubscriptionIdentity(identity)
        self.verifiedPurchases = purchases
        self.detailsIdentity = identity
    }

    private func reconcileTransaction(
        _ verification: VerificationResult<StoreKit.Transaction>,
        identity: AppleSubscriptionIdentity
    ) async throws {
        try self.store.requireAppleSubscriptionIdentity(identity)
        guard let transaction = try self.verifiedPremiumTransaction(verification) else { return }
        // Apple's original token is not ownership after Restore; only the server can resolve it.
        try await self.attach(verification: verification, transaction: transaction, identity: identity, intent: .passive)
    }

    private func verifiedPremiumTransaction(
        _ verification: VerificationResult<StoreKit.Transaction>
    ) throws -> StoreKit.Transaction? {
        switch verification {
        case .verified(let transaction):
            return transaction.productID == applePremiumProductId ? transaction : nil
        case .unverified(let transaction, let error):
            guard transaction.productID == applePremiumProductId else { return nil }
            throw error
        }
    }

    private func attach(
        verification: VerificationResult<StoreKit.Transaction>,
        transaction: StoreKit.Transaction,
        identity: AppleSubscriptionIdentity,
        intent: AppleBillingTransactionIntent
    ) async throws {
        while let active = self.processing[transaction.id] {
            if active.identity == identity, active.intent == intent {
                try await active.task.value
                try self.store.requireAppleSubscriptionIdentity(identity)
                return
            }
            // Different identities or intents must send separately, in order.
            _ = await active.task.result
            try self.store.requireAppleSubscriptionIdentity(identity)
            if self.processing[transaction.id]?.id == active.id {
                self.processing[transaction.id] = nil
            }
        }
        try self.store.requireAppleSubscriptionIdentity(identity)
        let operationId = UUID()
        let task = Task { @MainActor in
            try await self.store.attachAppleSubscription(
                signedTransaction: verification.jwsRepresentation,
                intent: intent,
                identity: identity,
                transport: self.transport
            )
            try self.store.requireAppleSubscriptionIdentity(identity)
            await transaction.finish()
            try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
            try self.store.requireAppleSubscriptionIdentity(identity)
            self.confirmationRevision += 1
            try await self.refreshPurchaseDetails(identity: identity)
        }
        self.processing[transaction.id] = (operationId, identity, intent, task)
        defer {
            if self.processing[transaction.id]?.id == operationId {
                self.processing[transaction.id] = nil
            }
        }
        try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
        try self.store.requireAppleSubscriptionIdentity(identity)
    }
}
