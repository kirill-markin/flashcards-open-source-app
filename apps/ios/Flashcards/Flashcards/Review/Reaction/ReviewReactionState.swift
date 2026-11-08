import Foundation

let reviewReactionMaximumActiveEvents: Int = 1

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
        totalWeight += max(entry.weight, 0)
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

/// One playback of a rating's reaction. A rating marks it, and it starts at the next display refresh,
/// after the frame that shows the next card.
struct ReviewReactionPlayback: Hashable, Sendable {
    let id: UUID
    let rating: ReviewReactionRating
    /// `nil` until the starting refresh builds a fresh reaction, when the rating had no unplayed prepared one.
    let reaction: ReviewReactionEvent?
    let isStarted: Bool
}

/// Picks the reaction a rating will play with the weighted roll over ready variants; `nil` when none is ready.
func makePreparedReviewReaction(
    rating: ReviewReactionRating,
    readyVariants: Set<ReviewReactionVariant>
) -> ReviewReactionEvent? {
    let totalWeight: Int = reviewReactionReadyVariantTotalWeight(rating: rating, readyVariants: readyVariants)
    guard totalWeight > 0, let variant: ReviewReactionVariant = selectReadyReviewReactionVariant(
        rating: rating,
        readyVariants: readyVariants,
        roll: Int.random(in: 0..<totalWeight)
    ) else {
        return nil
    }

    return ReviewReactionEvent(id: UUID(), rating: rating, variant: variant)
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
    guard (0..<totalWeight).contains(roll) else { return nil }

    var cumulativeWeight: Int = 0
    for entry in entries {
        cumulativeWeight += max(entry.weight, 0)
        if roll < cumulativeWeight {
            return entry.variant
        }
    }

    return nil
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
