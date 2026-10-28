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

enum PremiumPresentationReason: Equatable, Sendable {
    case aiLimit
    case premiumFeature(requiredTierRank: Int)
    case offerPreview
    case review(ReviewPaywallTrigger, reviewPromptConfigVersion: String)
}

struct PremiumPresentationRequest: Identifiable, Equatable {
    let id: UUID
    let reason: PremiumPresentationReason
    let analyticsEntryPoint: AnalyticsPaywallEntryPoint?
    let identity: AppleSubscriptionIdentity?

    var reviewTrigger: ReviewPaywallTrigger? {
        if case .review(let trigger, _) = self.reason { return trigger }
        return nil
    }

    var reviewPromptConfigVersion: String? {
        if case .review(_, let reviewPromptConfigVersion) = self.reason { return reviewPromptConfigVersion }
        return nil
    }

    var analyticsPresentation: AnalyticsPaywallPresentation? {
        self.analyticsEntryPoint.map {
            AnalyticsPaywallPresentation(id: self.id, entryPoint: $0, reviewTrigger: self.reviewTrigger)
        }
    }
}

enum PremiumPresentationOutcome: Equatable {
    case dismissed
    case continuedFree
    case accessGranted
    case identityChanged
    case superseded
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
    @ObservationIgnored private var shownRequestId: UUID?
    @ObservationIgnored private var shownScreen: AnalyticsSurface?
    @ObservationIgnored private var displayedOfferType: AnalyticsPurchaseOfferType?
    private(set) var result: PremiumPresentationResult? = nil

    @discardableResult
    func present(
        reason: PremiumPresentationReason,
        analyticsEntryPoint: AnalyticsPaywallEntryPoint?,
        entitlement: CloudEntitlement?,
        identity: AppleSubscriptionIdentity?
    ) -> UUID {
        self.finish(outcome: .superseded)
        let request = PremiumPresentationRequest(
            id: UUID(),
            reason: reason,
            analyticsEntryPoint: analyticsEntryPoint,
            identity: identity
        )
        self.displayedOfferType = nil
        self.hadPremiumAccessAtPresentation = hasPremiumAccess(entitlement: entitlement)
        self.result = nil
        self.request = request
        self.reconcileAccess(entitlement: entitlement, identity: identity)
        return request.id
    }

    func reconcileAccess(entitlement: CloudEntitlement?, identity: AppleSubscriptionIdentity?) {
        guard let request = self.request, let entitlement,
              let identity, request.identity == identity else { return }
        switch request.reason {
        case .premiumFeature(let requiredTierRank):
            if entitlement.tierRank >= requiredTierRank {
                self.finish(outcome: .accessGranted)
            }
        case .aiLimit, .review:
            // The AI screen keeps the refused draft; granting access never sends a billable turn.
            if self.hadPremiumAccessAtPresentation == false, hasPremiumAccess(entitlement: entitlement) {
                self.finish(outcome: .accessGranted)
            }
        case .offerPreview:
            break
        }
    }

    func recordShown(requestId: UUID, screen: AnalyticsSurface, store: FlashcardsStore) {
        guard let request = self.request, request.id == requestId, self.shownRequestId != requestId,
              request.analyticsEntryPoint != nil else { return }
        self.shownRequestId = requestId
        self.shownScreen = screen
        let now = Date()
        let timeZone = TimeZone.current
        store.recordActualPaywallShown(request: request, now: now, timeZone: timeZone)
        if let presentation = request.analyticsPresentation {
            Analytics.track(
                .paywallShown(
                    presentation: presentation,
                    localDate: paywallLocalDate(now: now, timeZone: timeZone),
                    timeZone: timeZone.identifier,
                    accountKind: request.identity.map { $0.isGuest ? .guest : .registered },
                    offerType: self.displayedOfferType,
                    reviewPromptConfigVersion: request.reviewPromptConfigVersion
                ),
                screen: screen
            )
        }
    }

    func updateDisplayedOffer(requestId: UUID, offerType: AnalyticsPurchaseOfferType?) {
        guard self.request?.id == requestId else { return }
        self.displayedOfferType = offerType
    }

    func recordChoice(requestId: UUID, outcome: AnalyticsPaywallChoiceOutcome) {
        guard let request = self.request, request.id == requestId,
              self.shownRequestId == requestId, let presentation = request.analyticsPresentation else { return }
        Analytics.track(.paywallChoice(presentation: presentation, outcome: outcome, offerType: self.displayedOfferType), screen: self.shownScreen)
    }

    func awaitAppleConfirmation(requestId: UUID, identity: AppleSubscriptionIdentity?) {
        guard self.request?.id == requestId, let identity, self.request?.identity == identity else { return }
        self.awaitingAppleRequestId = requestId
        self.awaitingAppleIdentity = identity
    }

    func cancelAppleConfirmation(requestId: UUID) {
        if self.awaitingAppleRequestId == requestId {
            self.awaitingAppleRequestId = nil
            self.awaitingAppleIdentity = nil
        }
    }

    func confirmAppleAccess(entitlement: CloudEntitlement?, identity: AppleSubscriptionIdentity?) {
        guard let request = self.request, self.awaitingAppleRequestId == request.id,
              let identity, request.identity == identity, self.awaitingAppleIdentity == identity,
              hasPremiumAccess(entitlement: entitlement) else { return }
        switch request.reason {
        case .premiumFeature, .aiLimit, .review:
            self.reconcileAccess(entitlement: entitlement, identity: identity)
        case .offerPreview:
            if self.hadPremiumAccessAtPresentation == false {
                self.finish(outcome: .accessGranted)
            }
        }
    }

    func finish(outcome: PremiumPresentationOutcome) {
        guard let request = self.request else {
            return
        }
        if outcome == .dismissed {
            self.recordChoice(requestId: request.id, outcome: .dismissed)
        }
        self.request = nil
        self.awaitingAppleRequestId = nil
        self.awaitingAppleIdentity = nil
        self.result = PremiumPresentationResult(requestId: request.id, outcome: outcome)
    }
}
