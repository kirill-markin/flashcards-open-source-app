import Foundation

enum PremiumPresentationReason: Equatable, Sendable {
    case aiLimit
    case premiumFeature(requiredTierRank: Int)
    case offerPreview
    case review(ReviewPaywallTrigger, reviewPromptConfigVersion: String)
}
