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
    private(set) var result: PremiumPresentationResult? = nil

    @discardableResult
    func present(reason: PremiumPresentationReason, entitlement: CloudEntitlement?) -> UUID {
        self.finish(outcome: .dismissed)
        let request = PremiumPresentationRequest(id: UUID(), reason: reason)
        self.result = nil
        self.request = request
        self.reconcileAccess(entitlement: entitlement)
        return request.id
    }

    func reconcileAccess(entitlement: CloudEntitlement?) {
        guard let request = self.request,
              case .premiumFeature(let requiredTierRank) = request.reason,
              let entitlement,
              entitlement.tierRank >= requiredTierRank else {
            return
        }
        self.finish(outcome: .accessGranted)
    }

    func finish(outcome: PremiumPresentationOutcome) {
        guard let request = self.request else {
            return
        }
        self.request = nil
        self.result = PremiumPresentationResult(requestId: request.id, outcome: outcome)
    }
}
