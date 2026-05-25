import Foundation

let reviewReactionMaximumActiveEvents: Int = 3

enum ReviewReactionMotionMode: Hashable, Sendable {
    case standard
    case reduced
}

enum ReviewReactionRating: CaseIterable, Hashable, Sendable {
    case again
    case hard
    case good
    case easy

    var debugIdentifier: String {
        String(describing: self)
    }
}

enum ReviewReactionVariant: CaseIterable, Hashable, Sendable {
    case againWormWiggle
    case againTornado
    case againSnailCrawl
    case againWiltedFlower
    case hardOxCharge
    case hardPawPrints
    case hardRacehorseGallop
    case hardVolcanoEruption
    case goodOwl
    case goodPoodle
    case goodWhale
    case goodPeacock
    case easyRoseBloom
    case easyRainbowStreak
    case easyPhoenixRise
    case easyUnicornFlyby
    case fallbackCrownBounce

    var debugIdentifier: String {
        String(describing: self)
    }

    var animationDurationSeconds: Double {
        switch self {
        case .hardRacehorseGallop:
            return 1.20
        case .easyRoseBloom:
            return 2.40
        case .goodPeacock:
            return 1.333
        case .againTornado:
            return 1.45
        case .hardOxCharge:
            return 1.55
        case .hardPawPrints, .fallbackCrownBounce:
            return 1.65
        case .easyRainbowStreak:
            return 2.00
        case .hardVolcanoEruption:
            return 2.05
        case .againWiltedFlower:
            return 2.40
        case .goodWhale:
            return 2.633
        case .againSnailCrawl:
            return 2.70
        case .goodPoodle:
            return 2.800
        case .goodOwl:
            return 2.833
        case .easyPhoenixRise:
            return 3.933
        case .easyUnicornFlyby:
            return 3.80
        case .againWormWiggle:
            return 4.267
        }
    }

    var cleanupDelayNanoseconds: UInt64 {
        let cleanupDelaySeconds = self.animationDurationSeconds + 0.08
        return UInt64(cleanupDelaySeconds * 1_000_000_000)
    }
}

struct ReviewReactionVariantDistributionEntry: Identifiable, Hashable, Sendable {
    let rating: ReviewReactionRating
    let variant: ReviewReactionVariant
    let weight: Int

    var id: String {
        "\(self.rating.debugIdentifier).\(self.variant.debugIdentifier)"
    }

    var probabilityPercent: Double {
        Double(self.weight) / Double(reviewReactionVariantTotalWeight(rating: self.rating)) * 100
    }
}

let allReviewReactionVariantDistributionEntries: [ReviewReactionVariantDistributionEntry] = [
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWormWiggle, weight: 40),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againTornado, weight: 30),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againSnailCrawl, weight: 22),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWiltedFlower, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardOxCharge, weight: 40),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardPawPrints, weight: 30),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardRacehorseGallop, weight: 22),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardVolcanoEruption, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodOwl, weight: 40),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPoodle, weight: 30),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodWhale, weight: 22),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPeacock, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyRoseBloom, weight: 40),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyRainbowStreak, weight: 30),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyPhoenixRise, weight: 22),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyUnicornFlyby, weight: 8)
]

func reviewReactionVariantDistributionEntries(
    rating: ReviewReactionRating
) -> [ReviewReactionVariantDistributionEntry] {
    allReviewReactionVariantDistributionEntries.filter { entry in
        entry.rating == rating
    }
}

func reviewReactionVariantTotalWeight(
    rating: ReviewReactionRating
) -> Int {
    let entries = reviewReactionVariantDistributionEntries(rating: rating)
    precondition(!entries.isEmpty, "Review reaction distribution is missing rating \(rating.debugIdentifier).")

    var totalWeight = 0
    for entry in entries {
        precondition(entry.weight > 0, "Invalid review reaction weight for \(entry.id): \(entry.weight).")
        totalWeight += entry.weight
    }

    return totalWeight
}

func reviewReactionCleanupDelayNanoseconds(
    variant: ReviewReactionVariant,
    motionMode: ReviewReactionMotionMode
) -> UInt64 {
    switch motionMode {
    case .standard:
        return variant.cleanupDelayNanoseconds
    case .reduced:
        return UInt64((ReviewReactionRenderer.reducedMotionDurationSeconds + 0.06) * 1_000_000_000)
    }
}

struct ReviewReactionEvent: Identifiable, Hashable, Sendable {
    let id: UUID
    let rating: ReviewReactionRating
    let variant: ReviewReactionVariant
}

func selectReviewReactionVariant(
    rating: ReviewReactionRating,
    roll: Int
) -> ReviewReactionVariant {
    let entries = reviewReactionVariantDistributionEntries(rating: rating)
    let totalWeight = reviewReactionVariantTotalWeight(rating: rating)
    precondition((0..<totalWeight).contains(roll), "Review reaction roll must be in 0..<\(totalWeight), received \(roll).")

    var cumulativeWeight = 0
    for entry in entries {
        cumulativeWeight += entry.weight
        if roll < cumulativeWeight {
            return entry.variant
        }
    }

    preconditionFailure("Review reaction distribution is missing rating \(rating.debugIdentifier) roll \(roll).")
}

func makeReviewReactionRating(rating: ReviewRating) -> ReviewReactionRating {
    switch rating {
    case .again:
        return .again
    case .hard:
        return .hard
    case .good:
        return .good
    case .easy:
        return .easy
    }
}

func appendReviewReactionEvent(
    events: [ReviewReactionEvent],
    event: ReviewReactionEvent,
    maximumActiveEvents: Int
) -> [ReviewReactionEvent] {
    precondition(maximumActiveEvents > 0, "Review reactions require at least one active event slot.")

    let nextEvents = events + [event]
    guard nextEvents.count > maximumActiveEvents else {
        return nextEvents
    }

    return Array(nextEvents.suffix(maximumActiveEvents))
}
