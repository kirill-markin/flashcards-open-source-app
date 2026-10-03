import Foundation
import Observation

let premiumTierRank: Int = 20

func hasPremiumAccess(entitlement: CloudEntitlement?) -> Bool {
    guard let entitlement else {
        return false
    }
    return entitlement.tierRank >= premiumTierRank
}

struct AIChatQuotaRefusal: Equatable {
    let id: UUID
    let userId: String?
    let cloudState: CloudAccountState?
}

enum PremiumPresentationReason: Equatable {
    case aiLimit
    case premiumFeature(requiredTierRank: Int)
    case offerPreview
    case sandboxOffer
}

struct PremiumPresentationRequest: Identifiable, Equatable {
    let id: UUID
    let reason: PremiumPresentationReason
}

enum PremiumPresentationOutcome: Equatable {
    case dismissed
    case accessGranted
    case identityChanged
}

struct PremiumPresentationResult: Equatable {
    let requestId: UUID
    let outcome: PremiumPresentationOutcome
}

@MainActor
@Observable
final class PremiumPresenter {
    private(set) var request: PremiumPresentationRequest? = nil
    private var hadPremiumAccessAtPresentation: Bool = false
    private var awaitingAppleRequestId: UUID?
    private var awaitingAppleIdentity: AppleSubscriptionIdentity?
    private(set) var result: PremiumPresentationResult? = nil

    @discardableResult
    func present(reason: PremiumPresentationReason, entitlement: CloudEntitlement?) -> UUID {
        self.finish(outcome: .dismissed)
        let request = PremiumPresentationRequest(id: UUID(), reason: reason)
        self.hadPremiumAccessAtPresentation = hasPremiumAccess(entitlement: entitlement)
        self.result = nil
        self.request = request
        self.reconcileAccess(entitlement: entitlement)
        return request.id
    }

    func reconcileAccess(entitlement: CloudEntitlement?) {
        guard let request = self.request, let entitlement else { return }
        switch request.reason {
        case .premiumFeature(let requiredTierRank):
            if entitlement.tierRank >= requiredTierRank {
                self.finish(outcome: .accessGranted)
            }
        case .aiLimit:
            // The AI screen keeps the refused draft; granting access never sends a billable turn.
            if self.hadPremiumAccessAtPresentation == false, hasPremiumAccess(entitlement: entitlement) {
                self.finish(outcome: .accessGranted)
            }
        case .offerPreview, .sandboxOffer:
            break
        }
    }

    func awaitAppleConfirmation(requestId: UUID, identity: AppleSubscriptionIdentity?) {
        guard self.request?.id == requestId, let identity else { return }
        self.awaitingAppleRequestId = requestId
        self.awaitingAppleIdentity = identity
    }

    func cancelAppleConfirmation(requestId: UUID) {
        if self.awaitingAppleRequestId == requestId { self.awaitingAppleRequestId = nil }
    }

    func confirmAppleAccess(entitlement: CloudEntitlement?, identity: AppleSubscriptionIdentity?) {
        guard let request = self.request, self.awaitingAppleRequestId == request.id,
              let identity, self.awaitingAppleIdentity == identity,
              hasPremiumAccess(entitlement: entitlement) else { return }
        self.finish(outcome: .accessGranted)
    }

    func finish(outcome: PremiumPresentationOutcome) {
        guard let request = self.request else {
            return
        }
        self.request = nil
        self.awaitingAppleRequestId = nil
        self.awaitingAppleIdentity = nil
        self.result = PremiumPresentationResult(requestId: request.id, outcome: outcome)
    }
}
