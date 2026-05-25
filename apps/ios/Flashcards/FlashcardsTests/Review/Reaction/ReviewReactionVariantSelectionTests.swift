import XCTest
@testable import Flashcards

final class ReviewReactionVariantSelectionTests: XCTestCase {
    func testAgainVariantBoundaries() {
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 0), .againRedScribbleSlash)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 399), .againRedScribbleSlash)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 400), .againRewindVortex)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 699), .againRewindVortex)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 700), .againStampFlyby)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 919), .againStampFlyby)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 920), .againWarningTape)
        XCTAssertEqual(selectReviewReactionVariant(rating: .again, roll: 999), .againWarningTape)
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
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 0), .goodOwl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 399), .goodOwl)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 400), .goodPoodle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 699), .goodPoodle)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 700), .goodWhale)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 919), .goodWhale)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 920), .goodPeacock)
        XCTAssertEqual(selectReviewReactionVariant(rating: .good, roll: 999), .goodPeacock)
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
