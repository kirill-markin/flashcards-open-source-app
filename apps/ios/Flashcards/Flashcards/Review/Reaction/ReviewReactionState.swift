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
    case againRainCloud
    case againTornado
    case againWindFace
    case againSnowflake
    case againSnailCrawl
    case againTurtle
    case againWiltedFlower
    case againSpider
    case againRat
    case againWormWiggle
    case hardTiger
    case hardTRex
    case hardShark
    case hardOxCharge
    case hardRacehorseGallop
    case hardSnake
    case hardVolcanoEruption
    case hardScorpion
    case hardPawPrints
    case hardRooster
    case goodOtter
    case goodOwl
    case goodRabbit
    case goodSeal
    case goodServiceDog
    case goodPoodle
    case goodChimpanzee
    case goodWhale
    case goodPeacock
    case goodPig
    case easySunrise
    case easySunriseOverMountains
    case easyRoseBloom
    case easyPeace
    case easyPlant
    case easyRainbowStreak
    case easyPhoenixRise
    case easyUnicornFlyby
    case fallbackCrownBounce

    var debugIdentifier: String {
        String(describing: self)
    }

    var animationDurationSeconds: Double {
        switch self {
        case .againWindFace:
            return 1.600
        case .hardTRex:
            return 1.550
        case .hardRacehorseGallop:
            return 1.20
        case .easySunriseOverMountains:
            return 1.200
        case .goodRabbit:
            return 1.333
        case .easyRoseBloom:
            return 2.40
        case .againSpider:
            return 2.400
        case .goodPeacock:
            return 1.333
        case .againTornado:
            return 1.45
        case .hardOxCharge:
            return 1.55
        case .hardScorpion:
            return 1.800
        case .hardPawPrints, .fallbackCrownBounce:
            return 1.65
        case .easyRainbowStreak:
            return 2.00
        case .hardVolcanoEruption:
            return 2.05
        case .againWiltedFlower:
            return 2.40
        case .goodSeal:
            return 2.567
        case .goodWhale:
            return 2.633
        case .againRat:
            return 2.633
        case .againSnailCrawl:
            return 2.70
        case .hardRooster:
            return 2.850
        case .goodPoodle:
            return 2.800
        case .goodOwl:
            return 2.833
        case .goodOtter, .goodServiceDog:
            return 3.000
        case .easyPeace:
            return 3.167
        case .hardShark:
            return 3.200
        case .againRainCloud, .hardSnake:
            return 3.267
        case .againTurtle:
            return 3.400
        case .goodPig:
            return 3.567
        case .goodChimpanzee:
            return 3.833
        case .easyPhoenixRise:
            return 3.933
        case .easyUnicornFlyby:
            return 3.80
        case .againSnowflake, .hardTiger, .easySunrise, .easyPlant:
            return 4.200
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
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againRainCloud, weight: 32),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againTornado, weight: 26),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWindFace, weight: 24),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againSnowflake, weight: 18),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againSnailCrawl, weight: 18),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againTurtle, weight: 16),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWiltedFlower, weight: 12),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againSpider, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againRat, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWormWiggle, weight: 6),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardTiger, weight: 32),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardTRex, weight: 26),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardShark, weight: 22),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardOxCharge, weight: 20),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardRacehorseGallop, weight: 18),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardSnake, weight: 16),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardVolcanoEruption, weight: 14),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardScorpion, weight: 10),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardPawPrints, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardRooster, weight: 8),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodOtter, weight: 32),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodOwl, weight: 28),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodRabbit, weight: 26),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodSeal, weight: 24),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodServiceDog, weight: 24),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPoodle, weight: 20),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodChimpanzee, weight: 18),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodWhale, weight: 16),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPeacock, weight: 12),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPig, weight: 10),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easySunrise, weight: 34),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easySunriseOverMountains, weight: 34),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyRoseBloom, weight: 30),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyPeace, weight: 28),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyPlant, weight: 26),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyRainbowStreak, weight: 24),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyPhoenixRise, weight: 18),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyUnicornFlyby, weight: 12)
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

func reviewReactionReadyVariantDistributionEntries(
    rating: ReviewReactionRating,
    readyVariants: Set<ReviewReactionVariant>
) -> [ReviewReactionVariantDistributionEntry] {
    reviewReactionVariantDistributionEntries(rating: rating).filter { entry in
        readyVariants.contains(entry.variant)
    }
}

func reviewReactionReadyVariantTotalWeight(
    rating: ReviewReactionRating,
    readyVariants: Set<ReviewReactionVariant>
) -> Int {
    let entries: [ReviewReactionVariantDistributionEntry] = reviewReactionReadyVariantDistributionEntries(
        rating: rating,
        readyVariants: readyVariants
    )

    var totalWeight: Int = 0
    for entry in entries {
        precondition(entry.weight > 0, "Invalid review reaction weight for \(entry.id): \(entry.weight).")
        totalWeight += entry.weight
    }

    return totalWeight
}

func reviewReactionAvailableVariantDistributionEntries(
    rating: ReviewReactionRating,
    availableVariants: Set<ReviewReactionVariant>
) -> [ReviewReactionVariantDistributionEntry] {
    reviewReactionVariantDistributionEntries(rating: rating).filter { entry in
        availableVariants.contains(entry.variant)
    }
}

func reviewReactionAvailableVariantTotalWeight(
    rating: ReviewReactionRating,
    availableVariants: Set<ReviewReactionVariant>
) -> Int {
    let entries: [ReviewReactionVariantDistributionEntry] = reviewReactionAvailableVariantDistributionEntries(
        rating: rating,
        availableVariants: availableVariants
    )

    var totalWeight: Int = 0
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

func selectReadyReviewReactionVariant(
    rating: ReviewReactionRating,
    readyVariants: Set<ReviewReactionVariant>,
    roll: Int
) -> ReviewReactionVariant? {
    let entries: [ReviewReactionVariantDistributionEntry] = reviewReactionReadyVariantDistributionEntries(
        rating: rating,
        readyVariants: readyVariants
    )
    guard entries.isEmpty == false else {
        return nil
    }

    let totalWeight: Int = reviewReactionReadyVariantTotalWeight(
        rating: rating,
        readyVariants: readyVariants
    )
    precondition((0..<totalWeight).contains(roll), "Ready review reaction roll must be in 0..<\(totalWeight), received \(roll).")

    var cumulativeWeight: Int = 0
    for entry in entries {
        cumulativeWeight += entry.weight
        if roll < cumulativeWeight {
            return entry.variant
        }
    }

    preconditionFailure("Ready review reaction distribution is missing rating \(rating.debugIdentifier) roll \(roll).")
}

func selectAvailableReviewReactionVariant(
    rating: ReviewReactionRating,
    availableVariants: Set<ReviewReactionVariant>,
    roll: Int
) -> ReviewReactionVariant? {
    let entries: [ReviewReactionVariantDistributionEntry] = reviewReactionAvailableVariantDistributionEntries(
        rating: rating,
        availableVariants: availableVariants
    )
    guard entries.isEmpty == false else {
        return nil
    }

    let totalWeight: Int = reviewReactionAvailableVariantTotalWeight(
        rating: rating,
        availableVariants: availableVariants
    )
    precondition((0..<totalWeight).contains(roll), "Available review reaction roll must be in 0..<\(totalWeight), received \(roll).")

    var cumulativeWeight: Int = 0
    for entry in entries {
        cumulativeWeight += entry.weight
        if roll < cumulativeWeight {
            return entry.variant
        }
    }

    preconditionFailure("Available review reaction distribution is missing rating \(rating.debugIdentifier) roll \(roll).")
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
