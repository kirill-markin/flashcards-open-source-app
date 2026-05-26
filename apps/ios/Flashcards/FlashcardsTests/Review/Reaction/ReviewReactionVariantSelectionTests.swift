import XCTest
@testable import Flashcards

private struct ExpectedReviewReactionDistribution {
    let rating: ReviewReactionRating
    let entries: [ExpectedReviewReactionDistributionEntry]
}

private struct ExpectedReviewReactionDistributionEntry {
    let variant: ReviewReactionVariant
    let weight: Int
}

private let expectedReviewReactionDistributions: [ExpectedReviewReactionDistribution] = [
    ExpectedReviewReactionDistribution(
        rating: .again,
        entries: [
            ExpectedReviewReactionDistributionEntry(variant: .againRainCloud, weight: 32),
            ExpectedReviewReactionDistributionEntry(variant: .againTornado, weight: 26),
            ExpectedReviewReactionDistributionEntry(variant: .againWindFace, weight: 24),
            ExpectedReviewReactionDistributionEntry(variant: .againSnowflake, weight: 18),
            ExpectedReviewReactionDistributionEntry(variant: .againSnailCrawl, weight: 18),
            ExpectedReviewReactionDistributionEntry(variant: .againTurtle, weight: 16),
            ExpectedReviewReactionDistributionEntry(variant: .againWiltedFlower, weight: 12),
            ExpectedReviewReactionDistributionEntry(variant: .againSpider, weight: 8),
            ExpectedReviewReactionDistributionEntry(variant: .againRat, weight: 8),
            ExpectedReviewReactionDistributionEntry(variant: .againWormWiggle, weight: 6)
        ]
    ),
    ExpectedReviewReactionDistribution(
        rating: .hard,
        entries: [
            ExpectedReviewReactionDistributionEntry(variant: .hardTiger, weight: 32),
            ExpectedReviewReactionDistributionEntry(variant: .hardTRex, weight: 26),
            ExpectedReviewReactionDistributionEntry(variant: .hardShark, weight: 22),
            ExpectedReviewReactionDistributionEntry(variant: .hardOxCharge, weight: 20),
            ExpectedReviewReactionDistributionEntry(variant: .hardRacehorseGallop, weight: 18),
            ExpectedReviewReactionDistributionEntry(variant: .hardSnake, weight: 16),
            ExpectedReviewReactionDistributionEntry(variant: .hardVolcanoEruption, weight: 14),
            ExpectedReviewReactionDistributionEntry(variant: .hardScorpion, weight: 10),
            ExpectedReviewReactionDistributionEntry(variant: .hardPawPrints, weight: 8),
            ExpectedReviewReactionDistributionEntry(variant: .hardRooster, weight: 8)
        ]
    ),
    ExpectedReviewReactionDistribution(
        rating: .good,
        entries: [
            ExpectedReviewReactionDistributionEntry(variant: .goodOtter, weight: 32),
            ExpectedReviewReactionDistributionEntry(variant: .goodOwl, weight: 28),
            ExpectedReviewReactionDistributionEntry(variant: .goodRabbit, weight: 26),
            ExpectedReviewReactionDistributionEntry(variant: .goodSeal, weight: 24),
            ExpectedReviewReactionDistributionEntry(variant: .goodServiceDog, weight: 24),
            ExpectedReviewReactionDistributionEntry(variant: .goodPoodle, weight: 20),
            ExpectedReviewReactionDistributionEntry(variant: .goodChimpanzee, weight: 18),
            ExpectedReviewReactionDistributionEntry(variant: .goodWhale, weight: 16),
            ExpectedReviewReactionDistributionEntry(variant: .goodPeacock, weight: 12),
            ExpectedReviewReactionDistributionEntry(variant: .goodPig, weight: 10)
        ]
    ),
    ExpectedReviewReactionDistribution(
        rating: .easy,
        entries: [
            ExpectedReviewReactionDistributionEntry(variant: .easySunrise, weight: 34),
            ExpectedReviewReactionDistributionEntry(variant: .easySunriseOverMountains, weight: 34),
            ExpectedReviewReactionDistributionEntry(variant: .easyRoseBloom, weight: 30),
            ExpectedReviewReactionDistributionEntry(variant: .easyPeace, weight: 28),
            ExpectedReviewReactionDistributionEntry(variant: .easyPlant, weight: 26),
            ExpectedReviewReactionDistributionEntry(variant: .easyRainbowStreak, weight: 24),
            ExpectedReviewReactionDistributionEntry(variant: .easyPhoenixRise, weight: 18),
            ExpectedReviewReactionDistributionEntry(variant: .easyUnicornFlyby, weight: 12)
        ]
    )
]

final class ReviewReactionVariantSelectionTests: XCTestCase {
    func testVariantBoundaries() {
        for distribution in expectedReviewReactionDistributions {
            var startRoll = 0
            for entry in distribution.entries {
                let endRoll = startRoll + entry.weight - 1
                XCTAssertEqual(selectReviewReactionVariant(rating: distribution.rating, roll: startRoll), entry.variant)
                XCTAssertEqual(selectReviewReactionVariant(rating: distribution.rating, roll: endRoll), entry.variant)
                startRoll += entry.weight
            }
        }
    }

    func testProbabilityPercentagesUseWeights() {
        for distribution in expectedReviewReactionDistributions {
            let totalWeight = distribution.entries.reduce(0) { result, entry in
                result + entry.weight
            }
            let expectedPercentages = distribution.entries.map { entry in
                Double(entry.weight) / Double(totalWeight) * 100
            }
            let actualPercentages = reviewReactionVariantDistributionEntries(rating: distribution.rating).map(\.probabilityPercent)
            XCTAssertEqual(actualPercentages.count, expectedPercentages.count)
            for index in expectedPercentages.indices {
                XCTAssertEqual(actualPercentages[index], expectedPercentages[index], accuracy: 0.0001)
            }
        }
    }
}
