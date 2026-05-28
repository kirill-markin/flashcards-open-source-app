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

    func testLottieAssetConfigurationsMatchDistributedVariants() {
        let distributedVariants: Set<ReviewReactionVariant> = Set(
            allReviewReactionVariantDistributionEntries.map(\.variant)
        )
        let configuredVariants: Set<ReviewReactionVariant> = Set(
            reviewReactionLottieAssetConfigurations.map(\.variant)
        )

        XCTAssertEqual(configuredVariants, distributedVariants)
    }

    func testLottieAssetConfigurationNamesAreUnique() {
        let assetNames: [String] = reviewReactionLottieAssetConfigurations.map(\.assetName)

        XCTAssertEqual(Set(assetNames).count, assetNames.count)
    }

    func testLottieAssetConfigurationVariantsAreUnique() {
        let variants: [ReviewReactionVariant] = reviewReactionLottieAssetConfigurations.map(\.variant)

        XCTAssertEqual(Set(variants).count, variants.count)
    }

    func testReviewReactionLottiePrewarmAssetConfigurationsInterleaveRatingGroups() {
        let prewarmVariants: [ReviewReactionVariant] = reviewReactionLottiePrewarmAssetConfigurations().map(\.variant)
        let configuredVariants: [ReviewReactionVariant] = reviewReactionLottieAssetConfigurations.map(\.variant)

        XCTAssertEqual(prewarmVariants.count, configuredVariants.count)
        XCTAssertEqual(Set(prewarmVariants), Set(configuredVariants))
        XCTAssertEqual(
            Array(prewarmVariants.prefix(4)),
            [.againRainCloud, .hardTiger, .goodOtter, .easySunrise]
        )
        XCTAssertEqual(
            Array(prewarmVariants.dropFirst(4).prefix(4)),
            [.againTornado, .hardTRex, .goodOwl, .easySunriseOverMountains]
        )
    }

    func testConfiguredLottieAssetsLoad() {
        var failedAssetMessages: [String] = []

        for assetConfiguration in reviewReactionLottieAssetConfigurations {
            let loadResult: ReviewReactionLottieAssetLoadResult = loadReviewReactionLottieAsset(
                assetConfiguration: assetConfiguration
            )
            switch loadResult {
            case .ready(let variant, _):
                XCTAssertEqual(variant, assetConfiguration.variant)
            case .failed(let failure):
                failedAssetMessages.append(
                    "\(failure.assetName): \(failure.failureReason) \(failure.message)"
                )
            }
        }

        XCTAssertTrue(failedAssetMessages.isEmpty, failedAssetMessages.joined(separator: "\n"))
    }

    func testReadyVariantSelectionPreservesBoundariesWhenAllRatingVariantsAreReady() {
        for distribution in expectedReviewReactionDistributions {
            let readyVariants: Set<ReviewReactionVariant> = Set(distribution.entries.map(\.variant))
            var startRoll: Int = 0
            for entry in distribution.entries {
                let endRoll: Int = startRoll + entry.weight - 1
                XCTAssertEqual(
                    selectReadyReviewReactionVariant(
                        rating: distribution.rating,
                        readyVariants: readyVariants,
                        roll: startRoll
                    ),
                    entry.variant
                )
                XCTAssertEqual(
                    selectReadyReviewReactionVariant(
                        rating: distribution.rating,
                        readyVariants: readyVariants,
                        roll: endRoll
                    ),
                    entry.variant
                )
                startRoll += entry.weight
            }
        }
    }

    func testReadyVariantSelectionReturnsNilWhenRatingHasNoReadyVariants() {
        let readyVariants: Set<ReviewReactionVariant> = [.hardTiger, .goodOwl, .easySunrise]

        XCTAssertEqual(
            reviewReactionReadyVariantTotalWeight(
                rating: .again,
                readyVariants: readyVariants
            ),
            0
        )
        XCTAssertNil(
            selectReadyReviewReactionVariant(
                rating: .again,
                readyVariants: readyVariants,
                roll: 0
            )
        )
    }

    func testReadyVariantSelectionUsesReadySameRatingVariantWhenHigherWeightVariantIsPending() {
        let readyVariants: Set<ReviewReactionVariant> = [.goodOwl]

        XCTAssertEqual(
            reviewReactionReadyVariantTotalWeight(
                rating: .good,
                readyVariants: readyVariants
            ),
            28
        )
        XCTAssertEqual(
            selectReadyReviewReactionVariant(
                rating: .good,
                readyVariants: readyVariants,
                roll: 0
            ),
            .goodOwl
        )
        XCTAssertEqual(
            selectReadyReviewReactionVariant(
                rating: .good,
                readyVariants: readyVariants,
                roll: 27
            ),
            .goodOwl
        )
    }

    func testAvailableVariantSelectionPreservesBoundariesWhenAllRatingVariantsAreAvailable() {
        for distribution in expectedReviewReactionDistributions {
            let availableVariants: Set<ReviewReactionVariant> = Set(distribution.entries.map(\.variant))
            var startRoll: Int = 0
            for entry in distribution.entries {
                let endRoll: Int = startRoll + entry.weight - 1
                XCTAssertEqual(
                    selectAvailableReviewReactionVariant(
                        rating: distribution.rating,
                        availableVariants: availableVariants,
                        roll: startRoll
                    ),
                    entry.variant
                )
                XCTAssertEqual(
                    selectAvailableReviewReactionVariant(
                        rating: distribution.rating,
                        availableVariants: availableVariants,
                        roll: endRoll
                    ),
                    entry.variant
                )
                startRoll += entry.weight
            }
        }
    }

    func testAvailableVariantSelectionReturnsNilWhenRatingHasNoAvailableVariants() {
        let availableVariants: Set<ReviewReactionVariant> = [.hardTiger, .goodOwl, .easySunrise]

        XCTAssertEqual(
            reviewReactionAvailableVariantTotalWeight(
                rating: .again,
                availableVariants: availableVariants
            ),
            0
        )
        XCTAssertNil(
            selectAvailableReviewReactionVariant(
                rating: .again,
                availableVariants: availableVariants,
                roll: 0
            )
        )
    }

    func testAvailableVariantSelectionCanChooseFailedAssetFallbackCandidate() {
        let availableVariants: Set<ReviewReactionVariant> = [.goodOtter]

        XCTAssertEqual(
            reviewReactionAvailableVariantTotalWeight(
                rating: .good,
                availableVariants: availableVariants
            ),
            32
        )
        XCTAssertEqual(
            selectAvailableReviewReactionVariant(
                rating: .good,
                availableVariants: availableVariants,
                roll: 0
            ),
            .goodOtter
        )
        XCTAssertEqual(
            selectAvailableReviewReactionVariant(
                rating: .good,
                availableVariants: availableVariants,
                roll: 31
            ),
            .goodOtter
        )
    }

    func testLottieAssetStoreAvailableVariantsExcludePendingVariants() {
        let failedAsset: ReviewReactionLottieAssetFailure = ReviewReactionLottieAssetFailure(
            variant: .goodOtter,
            assetName: "ReviewGoodOtter",
            assetDescription: "test asset",
            failureReason: "decode_failed",
            message: "test failure"
        )
        let store: ReviewReactionLottieAssetStore = ReviewReactionLottieAssetStore(
            readyAnimations: [:],
            failedAssets: [.goodOtter: failedAsset],
            pendingVariants: [.goodOwl]
        )

        XCTAssertEqual(store.availableVariants, [.goodOtter])
    }

    func testPendingLottieAssetDoesNotUseCrownFallback() {
        let readiness: ReviewReactionLottieAssetReadiness = ReviewReactionLottieAssetReadiness(
            readyVariants: [],
            pendingVariants: [.goodOtter],
            failedVariants: []
        )

        XCTAssertEqual(reviewReactionLottieAssetStatus(variant: .goodOtter, readiness: readiness), .pending)
        XCTAssertFalse(shouldUseReviewReactionCrownFallback(variant: .goodOtter, readiness: readiness))
    }

    func testFailedLottieAssetUsesCrownFallback() {
        let readiness: ReviewReactionLottieAssetReadiness = ReviewReactionLottieAssetReadiness(
            readyVariants: [],
            pendingVariants: [],
            failedVariants: [.goodOtter]
        )

        XCTAssertEqual(reviewReactionLottieAssetStatus(variant: .goodOtter, readiness: readiness), .failed)
        XCTAssertTrue(shouldUseReviewReactionCrownFallback(variant: .goodOtter, readiness: readiness))
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
