import XCTest
@testable import Flashcards

final class ReviewReactionVariantSelectionTests: XCTestCase {
    func testAgainVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 0), .againWormWiggle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 39), .againWormWiggle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 40), .againTornado)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 69), .againTornado)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 70), .againSnailCrawl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 91), .againSnailCrawl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 92), .againWiltedFlower)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 99), .againWiltedFlower)
    }

    func testHardVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 0), .hardOxCharge)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 39), .hardOxCharge)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 40), .hardPawPrints)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 69), .hardPawPrints)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 70), .hardRacehorseGallop)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 91), .hardRacehorseGallop)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 92), .hardVolcanoEruption)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 99), .hardVolcanoEruption)
    }

    func testGoodVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 0), .goodOwl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 39), .goodOwl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 40), .goodPoodle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 69), .goodPoodle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 70), .goodWhale)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 91), .goodWhale)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 92), .goodPeacock)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 99), .goodPeacock)
    }

    func testEasyVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 0), .easyRoseBloom)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 39), .easyRoseBloom)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 40), .easyRainbowStreak)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 69), .easyRainbowStreak)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 70), .easyPhoenixRise)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 91), .easyPhoenixRise)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 92), .easyUnicornFlyby)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 99), .easyUnicornFlyby)
    }

    func testProbabilityPercentagesUseWeights() {
        let expectedPercentages = [40.0, 30.0, 22.0, 8.0]

        for rating in ReviewReactionRating.allCases {
            let actualPercentages = reviewReactionVariantDistributionEntries(rating: rating).map(\.probabilityPercent)
            XCTAssertEqual(actualPercentages.count, expectedPercentages.count)
            for index in expectedPercentages.indices {
                XCTAssertEqual(actualPercentages[index], expectedPercentages[index], accuracy: 0.0001)
            }
        }
    }
}
