import Foundation
import StoreKit
import UIKit

private let applePremiumProductId: String = "premium_monthly"

enum AppleSubscriptionError: LocalizedError {
    case accountUnavailable
    case identityChanged
    case productUnavailable
    case sandboxRequired
    case attachmentNotConfirmed
    case unexpectedPurchaseResult

    var errorDescription: String? {
        switch self {
        case .accountUnavailable:
            return "An authenticated guest or linked account is required for Apple subscriptions."
        case .identityChanged:
            return "The account changed during the Apple subscription operation. Retry from the current account."
        case .productUnavailable:
            return "The App Store did not return the premium_monthly subscription."
        case .sandboxRequired:
            return "Test purchases require a verified App Store sandbox installation."
        case .attachmentNotConfirmed:
            return "The server did not confirm attachment of the Apple transaction."
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

@MainActor
final class AppleSubscriptionService {
    private let store: FlashcardsStore
    private let transport: CloudSyncTransport
    private var processing: [UInt64: (id: UUID, identity: AppleSubscriptionIdentity, task: Task<Void, Error>)] = [:]

    init(store: FlashcardsStore, session: URLSession) {
        self.store = store
        self.transport = CloudSyncTransport(session: session)
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

    func isSandboxTestEligible() async throws -> Bool {
        switch try await AppTransaction.shared {
        case .verified(let transaction):
            return transaction.environment == .sandbox
        case .unverified(_, let error):
            throw error
        }
    }

    func purchaseSandboxPremium() async throws -> AppleSubscriptionPurchaseResult {
        let identity = try self.store.appleSubscriptionIdentity()
        guard try await self.isSandboxTestEligible() else {
            throw AppleSubscriptionError.sandboxRequired
        }
        let offer = try await self.loadOffer()
        let token = try await self.store.appleSubscriptionAccountToken(identity: identity, transport: self.transport)
        try self.store.requireAppleSubscriptionIdentity(identity)
        let result = try await offer.product.purchase(options: [.appAccountToken(token)])
        try self.store.requireAppleSubscriptionIdentity(identity)
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
            try await self.attach(verification: verification, transaction: transaction, identity: identity)
            return .attached
        @unknown default:
            throw AppleSubscriptionError.unexpectedPurchaseResult
        }
    }

    func restorePurchases() async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        try await AppStore.sync()
        try self.store.requireAppleSubscriptionIdentity(identity)
        for await verification in StoreKit.Transaction.currentEntitlements {
            try self.store.requireAppleSubscriptionIdentity(identity)
            guard let transaction = try self.verifiedPremiumTransaction(verification) else { continue }
            // An explicit restore is the deliberate last-presenter-wins transfer path.
            try await self.attach(verification: verification, transaction: transaction, identity: identity)
        }
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
    }

    func reconcileCurrentEntitlements() async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        let token = try await self.store.appleSubscriptionAccountToken(identity: identity, transport: self.transport)
        for await verification in StoreKit.Transaction.currentEntitlements {
            try await self.attachOwnedTransaction(verification, identity: identity, appAccountToken: token)
        }
        // Revoked/expired unfinished transactions may be absent from currentEntitlements.
        for await verification in StoreKit.Transaction.unfinished {
            try await self.attachOwnedTransaction(verification, identity: identity, appAccountToken: token)
        }
        try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
    }

    // The caller owns cancellation and restarts this consumer when the authenticated identity changes.
    func consumeTransactionUpdates(onError: @MainActor (Error) -> Void) async throws {
        let identity = try self.store.appleSubscriptionIdentity()
        let token = try await self.store.appleSubscriptionAccountToken(identity: identity, transport: self.transport)
        for await verification in StoreKit.Transaction.updates {
            try self.store.requireAppleSubscriptionIdentity(identity)
            do {
                try await self.attachOwnedTransaction(verification, identity: identity, appAccountToken: token)
            } catch {
                try self.store.requireAppleSubscriptionIdentity(identity)
                onError(error)
            }
        }
        try self.store.requireAppleSubscriptionIdentity(identity)
    }

    func manageSubscriptions(in scene: UIWindowScene) async throws {
        try await AppStore.showManageSubscriptions(in: scene)
    }

    private func attachOwnedTransaction(
        _ verification: VerificationResult<StoreKit.Transaction>,
        identity: AppleSubscriptionIdentity,
        appAccountToken: UUID
    ) async throws {
        try self.store.requireAppleSubscriptionIdentity(identity)
        guard let transaction = try self.verifiedPremiumTransaction(verification),
              transaction.appAccountToken == appAccountToken else { return }
        // Automatic redelivery must not move a previous account’s in-flight purchase.
        try await self.attach(verification: verification, transaction: transaction, identity: identity)
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
        identity: AppleSubscriptionIdentity
    ) async throws {
        while let active = self.processing[transaction.id] {
            if active.identity == identity {
                try await active.task.value
                try self.store.requireAppleSubscriptionIdentity(identity)
                return
            }
            // A restore for a replacement account must send after the previous attachment settles.
            // Its result belongs to that old caller; this caller still performs its own attachment.
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
                identity: identity,
                transport: self.transport
            )
            try self.store.requireAppleSubscriptionIdentity(identity)
            await transaction.finish()
            try await self.store.refreshAppleSubscriptionEntitlement(identity: identity)
        }
        self.processing[transaction.id] = (operationId, identity, task)
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
