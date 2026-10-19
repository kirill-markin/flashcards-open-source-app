import Foundation
import Observation
import OSLog
import StoreKit
import UIKit

private let applePremiumProductId: String = "premium_monthly"
private let appleSubscriptionLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "apple_subscription"
)

enum AppleSubscriptionError: LocalizedError {
    case accountUnavailable
    case identityChanged
    case productUnavailable
    case attachmentNotConfirmed
    case entitlementNotConfirmed
    case premiumAlreadyAvailable
    case unexpectedPurchaseResult
    case subscriptionManagementOpenFailed

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
        case .subscriptionManagementOpenFailed:
            return "Apple's subscription management page could not be opened. Open https://apps.apple.com/account/subscriptions to manage your subscription."
        }
    }
}

struct AppleSubscriptionOffer {
    let product: Product
    let isEligibleForIntroOffer: Bool

    var displayPrice: String { self.product.displayPrice }

    var includesFreeTrial: Bool {
        self.isEligibleForIntroOffer && self.product.subscription?.introductoryOffer?.paymentMode == .freeTrial
    }
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

/// The provider's own code for what failed, named as `purchase_finished.error_code` in the catalog.
private func analyticsPurchaseErrorCode(error: any Error) -> AnalyticsPurchaseErrorCode {
    switch error {
    case let storeKitError as StoreKitError:
        switch storeKitError {
        case .unknown:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "unknown")
        case .userCancelled:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "userCancelled")
        case .networkError(let urlError):
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "networkError.\(urlError.code.rawValue)")
        case .systemError(let systemError):
            let nsError = systemError as NSError
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "systemError.\(nsError.domain).\(nsError.code)")
        case .notAvailableInStorefront:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "notAvailableInStorefront")
        case .notEntitled:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "notEntitled")
        case .unsupported:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "unsupported")
        case .invalidPresentationContext:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidPresentationContext")
        @unknown default:
            return nsErrorPurchaseErrorCode(error: storeKitError)
        }
    case let purchaseError as Product.PurchaseError:
        switch purchaseError {
        case .invalidQuantity:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidQuantity")
        case .productUnavailable:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "productUnavailable")
        case .purchaseNotAllowed:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "purchaseNotAllowed")
        case .ineligibleForOffer:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "ineligibleForOffer")
        case .invalidOfferIdentifier:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidOfferIdentifier")
        case .invalidOfferPrice:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidOfferPrice")
        case .invalidOfferSignature:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidOfferSignature")
        case .missingOfferParameters:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "missingOfferParameters")
        case .paymentMethodBindingConfigurationRequired:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "paymentMethodBindingConfigurationRequired")
        @unknown default:
            return nsErrorPurchaseErrorCode(error: purchaseError)
        }
    case let verificationError as VerificationResult<StoreKit.Transaction>.VerificationError:
        switch verificationError {
        case .revokedCertificate:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "revokedCertificate")
        case .invalidCertificateChain:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidCertificateChain")
        case .invalidDeviceVerification:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidDeviceVerification")
        case .invalidEncoding:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidEncoding")
        case .invalidSignature:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "invalidSignature")
        case .missingRequiredProperties:
            return AnalyticsPurchaseErrorCode(source: .storekit, code: "missingRequiredProperties")
        @unknown default:
            return nsErrorPurchaseErrorCode(error: verificationError)
        }
    case let subscriptionError as AppleSubscriptionError:
        switch subscriptionError {
        case .accountUnavailable:
            return AnalyticsPurchaseErrorCode(source: .app, code: "accountUnavailable")
        case .identityChanged:
            return AnalyticsPurchaseErrorCode(source: .app, code: "identityChanged")
        case .productUnavailable:
            return AnalyticsPurchaseErrorCode(source: .app, code: "productUnavailable")
        case .attachmentNotConfirmed:
            return AnalyticsPurchaseErrorCode(source: .app, code: "attachmentNotConfirmed")
        case .entitlementNotConfirmed:
            return AnalyticsPurchaseErrorCode(source: .app, code: "entitlementNotConfirmed")
        case .premiumAlreadyAvailable:
            return AnalyticsPurchaseErrorCode(source: .app, code: "premiumAlreadyAvailable")
        case .unexpectedPurchaseResult:
            return AnalyticsPurchaseErrorCode(source: .app, code: "unexpectedPurchaseResult")
        case .subscriptionManagementOpenFailed:
            return AnalyticsPurchaseErrorCode(source: .app, code: "subscriptionManagementOpenFailed")
        }
    default:
        return nsErrorPurchaseErrorCode(error: error)
    }
}

private func nsErrorPurchaseErrorCode(error: any Error) -> AnalyticsPurchaseErrorCode {
    let nsError = error as NSError
    return AnalyticsPurchaseErrorCode(source: .nserror, code: "\(nsError.domain).\(nsError.code)")
}

private struct ApplePremiumRestoredPurchase {
    let verification: VerificationResult<StoreKit.Transaction>
    let transaction: StoreKit.Transaction
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

    func purchasePremium(offer: AppleSubscriptionOffer, presentation: AnalyticsPaywallPresentation?) async throws -> AppleSubscriptionPurchaseResult {
        let identity = try self.store.appleSubscriptionIdentity()
        let token = try await self.store.appleSubscriptionAccountToken(identity: identity, transport: self.transport)
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        try self.store.requireAppleSubscriptionIdentity(identity)
        guard let entitlement = self.store.cloudEntitlement else {
            throw AppleSubscriptionError.entitlementNotConfirmed
        }
        guard hasPremiumAccess(entitlement: entitlement) == false else {
            throw AppleSubscriptionError.premiumAlreadyAvailable
        }
        self.trackForCurrentIdentity(
            .purchaseStarted(offerType: offer.includesFreeTrial ? .freeTrial : .standard, presentation: presentation),
            identity: identity
        )
        let purchase: ApplePremiumStorePurchase
        do {
            purchase = try await self.storePurchase(product: offer.product, token: token)
        } catch {
            self.trackForCurrentIdentity(
                .purchaseFinished(outcome: .failed(errorCode: analyticsPurchaseErrorCode(error: error)), presentation: presentation),
                identity: identity
            )
            throw error
        }
        self.trackForCurrentIdentity(.purchaseFinished(outcome: purchase.analyticsOutcome, presentation: presentation), identity: identity)
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
            guard let transaction = try self.verifiedPremiumTransaction(verification) else {
                appleSubscriptionLogger.error("event=apple_store_purchase_rejected reason=product_mismatch")
                throw AppleSubscriptionError.unexpectedPurchaseResult
            }
            if transaction.appAccountToken != token {
                appleSubscriptionLogger.warning(
                    """
                    event=apple_store_purchase_account_token_mismatch \
                    token_present=\(String(transaction.appAccountToken != nil), privacy: .public)
                    """
                )
            }
            return .verified(verification: verification, transaction: transaction)
        @unknown default:
            appleSubscriptionLogger.error("event=apple_store_purchase_rejected reason=unknown_result")
            throw AppleSubscriptionError.unexpectedPurchaseResult
        }
    }

    func restorePurchases() async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        let restoredPurchases: [ApplePremiumRestoredPurchase]
        do {
            restoredPurchases = try await self.storeRestoredPremiumPurchases(identity: identity)
        } catch {
            self.trackForCurrentIdentity(.purchaseRestoreFinished(outcome: .failed), identity: identity)
            throw error
        }
        self.trackForCurrentIdentity(
            .purchaseRestoreFinished(outcome: restoredPurchases.isEmpty ? .nothingToRestore : .restored),
            identity: identity
        )
        for purchase in restoredPurchases {
            // An explicit restore is the deliberate last-presenter-wins transfer path.
            try await self.attach(
                verification: purchase.verification,
                transaction: purchase.transaction,
                identity: identity,
                intent: .explicit
            )
        }
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        try await self.refreshPurchaseDetails(identity: identity)
        self.runtimeErrorMessage = nil
    }

    private func storeRestoredPremiumPurchases(
        identity: AppleSubscriptionIdentity
    ) async throws -> [ApplePremiumRestoredPurchase] {
        try await AppStore.sync()
        try self.store.requireAppleSubscriptionIdentity(identity)
        var purchases: [ApplePremiumRestoredPurchase] = []
        for await verification in StoreKit.Transaction.currentEntitlements {
            try self.store.requireAppleSubscriptionIdentity(identity)
            guard let transaction = try self.verifiedPremiumTransaction(verification) else { continue }
            purchases.append(ApplePremiumRestoredPurchase(verification: verification, transaction: transaction))
        }
        return purchases
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
        #if targetEnvironment(macCatalyst)
        guard let managementURL = URL(string: "https://apps.apple.com/account/subscriptions") else {
            throw AppleSubscriptionError.subscriptionManagementOpenFailed
        }
        guard await UIApplication.shared.open(managementURL, options: [:]) else {
            throw AppleSubscriptionError.subscriptionManagementOpenFailed
        }
        #else
        try await AppStore.showManageSubscriptions(in: scene)
        #endif
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
