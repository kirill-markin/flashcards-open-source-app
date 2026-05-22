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
    case againRedScribbleSlash
    case againRewindVortex
    case againStampFlyby
    case againWarningTape
    case hardHourglassSand
    case hardFallingWeight
    case hardYellowCrack
    case hardRollingBoulder
    case goodHandDrawnCheck
    case goodLightSweep
    case goodPaperPlaneCheck
    case goodCheckSealBounce
    case easySparkleBurst
    case easyRainbowStreak
    case easyCrownBounce
    case easyUnicornFlyby

    var debugIdentifier: String {
        String(describing: self)
    }

    var animationDurationSeconds: Double {
        switch self {
        case .goodHandDrawnCheck:
            return 1.15
        case .againRedScribbleSlash, .hardYellowCrack:
            return 1.20
        case .easySparkleBurst:
            return 1.25
        case .againRewindVortex, .goodLightSweep, .goodCheckSealBounce:
            return 1.45
        case .hardHourglassSand, .againWarningTape, .easyRainbowStreak:
            return 1.55
        case .hardFallingWeight, .easyCrownBounce:
            return 1.65
        case .goodPaperPlaneCheck:
            return 1.75
        case .againStampFlyby:
            return 1.90
        case .hardRollingBoulder:
            return 2.05
        case .easyUnicornFlyby:
            return 3.80
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
    let rollRange: ClosedRange<Int>

    var id: String {
        "\(self.rating.debugIdentifier).\(self.variant.debugIdentifier)"
    }

    var rollCount: Int {
        self.rollRange.upperBound - self.rollRange.lowerBound + 1
    }

    var probabilityPercent: Double {
        Double(self.rollCount) / 10
    }
}

let allReviewReactionVariantDistributionEntries: [ReviewReactionVariantDistributionEntry] = [
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againRedScribbleSlash, rollRange: 0...399),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againRewindVortex, rollRange: 400...699),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againStampFlyby, rollRange: 700...919),
    ReviewReactionVariantDistributionEntry(rating: .again, variant: .againWarningTape, rollRange: 920...999),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardHourglassSand, rollRange: 0...399),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardFallingWeight, rollRange: 400...699),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardYellowCrack, rollRange: 700...919),
    ReviewReactionVariantDistributionEntry(rating: .hard, variant: .hardRollingBoulder, rollRange: 920...999),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodHandDrawnCheck, rollRange: 0...399),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodLightSweep, rollRange: 400...699),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodPaperPlaneCheck, rollRange: 700...919),
    ReviewReactionVariantDistributionEntry(rating: .good, variant: .goodCheckSealBounce, rollRange: 920...999),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easySparkleBurst, rollRange: 0...399),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyRainbowStreak, rollRange: 400...699),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyCrownBounce, rollRange: 700...919),
    ReviewReactionVariantDistributionEntry(rating: .easy, variant: .easyUnicornFlyby, rollRange: 920...999)
]

func reviewReactionVariantDistributionEntries(
    rating: ReviewReactionRating
) -> [ReviewReactionVariantDistributionEntry] {
    allReviewReactionVariantDistributionEntries.filter { entry in
        entry.rating == rating
    }
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
    precondition((0...999).contains(roll), "Review reaction roll must be in 0...999, received \(roll).")

    guard let entry = reviewReactionVariantDistributionEntries(rating: rating).first(where: { entry in
        entry.rollRange.contains(roll)
    }) else {
        preconditionFailure("Review reaction distribution is missing rating \(rating.debugIdentifier) roll \(roll).")
    }

    return entry.variant
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
