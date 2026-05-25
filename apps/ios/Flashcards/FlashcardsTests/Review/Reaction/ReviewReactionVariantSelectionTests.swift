import XCTest
@testable import Flashcards

final class ReviewReactionVariantSelectionTests: XCTestCase {
    func testAgainVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 0), .againWormWiggle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 399), .againWormWiggle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 400), .againRewindVortex)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 699), .againRewindVortex)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 700), .againSnailCrawl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 919), .againSnailCrawl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 920), .againWiltedFlower)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 999), .againWiltedFlower)
    }

    func testHardVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 0), .hardHourglassSand)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 399), .hardHourglassSand)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 400), .hardFallingWeight)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 699), .hardFallingWeight)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 700), .hardYellowCrack)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 919), .hardYellowCrack)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 920), .hardRollingBoulder)
        XCTAssertEqual(selectReviewReactionVariant(rating: .hard, roll: 999), .hardRollingBoulder)
    }

    func testGoodVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 0), .goodHandDrawnCheck)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 399), .goodHandDrawnCheck)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 400), .goodLightSweep)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 699), .goodLightSweep)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 700), .goodPaperPlaneCheck)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 919), .goodPaperPlaneCheck)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 920), .goodCheckSealBounce)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 999), .goodCheckSealBounce)
    }

    func testEasyVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 0), .easySparkleBurst)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 399), .easySparkleBurst)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 400), .easyRainbowStreak)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 699), .easyRainbowStreak)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 700), .easyCrownBounce)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 919), .easyCrownBounce)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 920), .easyUnicornFlyby)
        XCTAssertEqual(selectReviewReactionVariant(rating: .easy, roll: 999), .easyUnicornFlyby)
    }
}
