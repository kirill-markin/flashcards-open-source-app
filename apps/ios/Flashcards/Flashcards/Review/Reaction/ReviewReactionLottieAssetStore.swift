import Foundation
import Lottie
import OSLog
import UIKit

let reviewReactionLottieFallbackVariant: ReviewReactionVariant = .fallbackCrownBounce

private let reviewReactionLottieAssetLogger: Logger = Logger(
    subsystem: appBundleIdentifier(),
    category: "review_reactions"
)

struct ReviewReactionLottieAssetConfiguration: Hashable, Sendable {
    let variant: ReviewReactionVariant
    let assetName: String
    let assetDescription: String
    let frameScale: CGFloat
    let centerX: CGFloat
    let centerY: CGFloat
}

struct ReviewReactionLottieAssetFailure: Hashable, Sendable {
    let variant: ReviewReactionVariant
    let assetName: String
    let assetDescription: String
    let failureReason: String
    let message: String
}

struct ReviewReactionLottieAssetReadiness: Hashable, Sendable {
    let readyVariants: Set<ReviewReactionVariant>
    let pendingVariants: Set<ReviewReactionVariant>
    let failedVariants: Set<ReviewReactionVariant>
}

enum ReviewReactionLottieAssetStatus: Hashable, Sendable {
    case ready
    case pending
    case failed
    case notLottie
}

enum ReviewReactionLottieAssetLoadResult: @unchecked Sendable {
    case ready(variant: ReviewReactionVariant, animation: LottieAnimation)
    case failed(failure: ReviewReactionLottieAssetFailure)
}

typealias ReviewReactionLottieAssetLoadHandler = @MainActor @Sendable (ReviewReactionLottieAssetLoadResult) -> Void

struct ReviewReactionLottieAssetStore {
    let readyAnimations: [ReviewReactionVariant: LottieAnimation]
    let failedAssets: [ReviewReactionVariant: ReviewReactionLottieAssetFailure]
    let pendingVariants: Set<ReviewReactionVariant>

    var readyVariants: Set<ReviewReactionVariant> {
        Set(self.readyAnimations.keys)
    }

    var failedVariants: Set<ReviewReactionVariant> {
        Set(self.failedAssets.keys)
    }

    var availableVariants: Set<ReviewReactionVariant> {
        self.readyVariants.union(self.failedVariants)
    }

    var readiness: ReviewReactionLottieAssetReadiness {
        ReviewReactionLottieAssetReadiness(
            readyVariants: self.readyVariants,
            pendingVariants: self.pendingVariants,
            failedVariants: self.failedVariants
        )
    }

    func recordingLoadResult(loadResult: ReviewReactionLottieAssetLoadResult) -> ReviewReactionLottieAssetStore {
        switch loadResult {
        case .ready(let variant, let animation):
            return self.recordingReadyAsset(variant: variant, animation: animation)
        case .failed(let failure):
            return self.recordingFailedAsset(failure: failure)
        }
    }

    private func recordingReadyAsset(
        variant: ReviewReactionVariant,
        animation: LottieAnimation
    ) -> ReviewReactionLottieAssetStore {
        var nextReadyAnimations: [ReviewReactionVariant: LottieAnimation] = self.readyAnimations
        var nextFailedAssets: [ReviewReactionVariant: ReviewReactionLottieAssetFailure] = self.failedAssets
        var nextPendingVariants: Set<ReviewReactionVariant> = self.pendingVariants

        nextReadyAnimations[variant] = animation
        nextFailedAssets.removeValue(forKey: variant)
        nextPendingVariants.remove(variant)

        return ReviewReactionLottieAssetStore(
            readyAnimations: nextReadyAnimations,
            failedAssets: nextFailedAssets,
            pendingVariants: nextPendingVariants
        )
    }

    private func recordingFailedAsset(
        failure: ReviewReactionLottieAssetFailure
    ) -> ReviewReactionLottieAssetStore {
        var nextReadyAnimations: [ReviewReactionVariant: LottieAnimation] = self.readyAnimations
        var nextFailedAssets: [ReviewReactionVariant: ReviewReactionLottieAssetFailure] = self.failedAssets
        var nextPendingVariants: Set<ReviewReactionVariant> = self.pendingVariants

        nextReadyAnimations.removeValue(forKey: failure.variant)
        nextFailedAssets[failure.variant] = failure
        nextPendingVariants.remove(failure.variant)

        return ReviewReactionLottieAssetStore(
            readyAnimations: nextReadyAnimations,
            failedAssets: nextFailedAssets,
            pendingVariants: nextPendingVariants
        )
    }
}

let reviewReactionLottieAssetConfigurations: [ReviewReactionLottieAssetConfiguration] = [
    ReviewReactionLottieAssetConfiguration(
        variant: .againRainCloud,
        assetName: "ReviewAgainRainCloud",
        assetDescription: "rain cloud",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.44
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againTornado,
        assetName: "ReviewAgainTornado",
        assetDescription: "tornado",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWindFace,
        assetName: "ReviewAgainWindFace",
        assetDescription: "wind face",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSnowflake,
        assetName: "ReviewAgainSnowflake",
        assetDescription: "snowflake",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.45
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSnailCrawl,
        assetName: "ReviewAgainSnail",
        assetDescription: "snail",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againTurtle,
        assetName: "ReviewAgainTurtle",
        assetDescription: "turtle",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWiltedFlower,
        assetName: "ReviewAgainWiltedFlower",
        assetDescription: "wilted flower",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againSpider,
        assetName: "ReviewAgainSpider",
        assetDescription: "spider",
        frameScale: 0.54,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againRat,
        assetName: "ReviewAgainRat",
        assetDescription: "rat",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .againWormWiggle,
        assetName: "ReviewAgainWorm",
        assetDescription: "worm",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.52
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardTiger,
        assetName: "ReviewHardTiger",
        assetDescription: "tiger",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardTRex,
        assetName: "ReviewHardTRex",
        assetDescription: "t rex",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardShark,
        assetName: "ReviewHardShark",
        assetDescription: "shark",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardOxCharge,
        assetName: "ReviewHardOx",
        assetDescription: "ox",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardRacehorseGallop,
        assetName: "ReviewHardRacehorse",
        assetDescription: "racehorse",
        frameScale: 0.62,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardSnake,
        assetName: "ReviewHardSnake",
        assetDescription: "snake",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardVolcanoEruption,
        assetName: "ReviewHardVolcano",
        assetDescription: "volcano",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardScorpion,
        assetName: "ReviewHardScorpion",
        assetDescription: "scorpion",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardPawPrints,
        assetName: "ReviewHardPawPrints",
        assetDescription: "paw prints",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .hardRooster,
        assetName: "ReviewHardRooster",
        assetDescription: "rooster",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodOtter,
        assetName: "ReviewGoodOtter",
        assetDescription: "otter",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodOwl,
        assetName: "ReviewGoodOwl",
        assetDescription: "owl",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodRabbit,
        assetName: "ReviewGoodRabbit",
        assetDescription: "rabbit",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodSeal,
        assetName: "ReviewGoodSeal",
        assetDescription: "seal",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodServiceDog,
        assetName: "ReviewGoodServiceDog",
        assetDescription: "service dog",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.47
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPoodle,
        assetName: "ReviewGoodPoodle",
        assetDescription: "poodle",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.43
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodChimpanzee,
        assetName: "ReviewGoodChimpanzee",
        assetDescription: "chimpanzee",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.46
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodWhale,
        assetName: "ReviewGoodWhale",
        assetDescription: "whale",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPeacock,
        assetName: "ReviewGoodPeacock",
        assetDescription: "peacock",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .goodPig,
        assetName: "ReviewGoodPig",
        assetDescription: "pig",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easySunrise,
        assetName: "ReviewEasySunrise",
        assetDescription: "sunrise",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easySunriseOverMountains,
        assetName: "ReviewEasySunriseOverMountains",
        assetDescription: "sunrise over mountains",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.44
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyRoseBloom,
        assetName: "ReviewEasyRose",
        assetDescription: "rose",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPeace,
        assetName: "ReviewEasyPeace",
        assetDescription: "peace",
        frameScale: 0.56,
        centerX: 0.50,
        centerY: 0.48
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPlant,
        assetName: "ReviewEasyPlant",
        assetDescription: "plant",
        frameScale: 0.58,
        centerX: 0.50,
        centerY: 0.50
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyRainbowStreak,
        assetName: "ReviewEasyRainbow",
        assetDescription: "rainbow",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyPhoenixRise,
        assetName: "ReviewEasyPhoenix",
        assetDescription: "phoenix",
        frameScale: 0.64,
        centerX: 0.50,
        centerY: 0.42
    ),
    ReviewReactionLottieAssetConfiguration(
        variant: .easyUnicornFlyby,
        assetName: "ReviewEasyUnicorn",
        assetDescription: "unicorn",
        frameScale: 0.52,
        centerX: 0.56,
        centerY: 0.30
    )
]

func makePendingReviewReactionLottieAssetStore() -> ReviewReactionLottieAssetStore {
    ReviewReactionLottieAssetStore(
        readyAnimations: [:],
        failedAssets: [:],
        pendingVariants: Set(reviewReactionLottieAssetConfigurations.map(\.variant))
    )
}

func loadReviewReactionLottieAsset(
    assetConfiguration: ReviewReactionLottieAssetConfiguration
) -> ReviewReactionLottieAssetLoadResult {
    guard let dataAsset: NSDataAsset = NSDataAsset(name: assetConfiguration.assetName) else {
        let failure: ReviewReactionLottieAssetFailure = ReviewReactionLottieAssetFailure(
            variant: assetConfiguration.variant,
            assetName: assetConfiguration.assetName,
            assetDescription: assetConfiguration.assetDescription,
            failureReason: "missing_data_asset",
            message: "Review Lottie data asset is missing."
        )
        logReviewReactionLottieAssetFailure(failure: failure)
        return .failed(failure: failure)
    }

    do {
        let animation: LottieAnimation = try LottieAnimation.from(data: dataAsset.data)
        return .ready(variant: assetConfiguration.variant, animation: animation)
    } catch {
        let failure: ReviewReactionLottieAssetFailure = ReviewReactionLottieAssetFailure(
            variant: assetConfiguration.variant,
            assetName: assetConfiguration.assetName,
            assetDescription: assetConfiguration.assetDescription,
            failureReason: "decode_failed",
            message: String(describing: error)
        )
        logReviewReactionLottieAssetFailure(failure: failure)
        return .failed(failure: failure)
    }
}

func reviewReactionLottiePrewarmAssetConfigurations() -> [ReviewReactionLottieAssetConfiguration] {
    let configurationsByVariant: [ReviewReactionVariant: ReviewReactionLottieAssetConfiguration] = Dictionary(
        uniqueKeysWithValues: reviewReactionLottieAssetConfigurations.map { assetConfiguration in
            (assetConfiguration.variant, assetConfiguration)
        }
    )
    let ratingEntries: [[ReviewReactionVariantDistributionEntry]] = ReviewReactionRating.allCases.map { rating in
        reviewReactionVariantDistributionEntries(rating: rating)
    }
    let maximumVariantCount: Int = ratingEntries.map(\.count).max() ?? 0

    var orderedConfigurations: [ReviewReactionLottieAssetConfiguration] = []
    for index in 0..<maximumVariantCount {
        for entries in ratingEntries where index < entries.count {
            let variant: ReviewReactionVariant = entries[index].variant
            guard let assetConfiguration: ReviewReactionLottieAssetConfiguration = configurationsByVariant[variant] else {
                preconditionFailure("Review Lottie asset configuration is missing variant \(variant.debugIdentifier).")
            }
            orderedConfigurations.append(assetConfiguration)
        }
    }

    return orderedConfigurations
}

func startReviewReactionLottieAssetPrewarm(
    onLoadResult: @escaping ReviewReactionLottieAssetLoadHandler
) {
    Task.detached(priority: .utility) {
        for assetConfiguration in reviewReactionLottiePrewarmAssetConfigurations() {
            let loadResult: ReviewReactionLottieAssetLoadResult = loadReviewReactionLottieAsset(
                assetConfiguration: assetConfiguration
            )
            await MainActor.run {
                onLoadResult(loadResult)
            }
        }
    }
}

func isReviewReactionLottieVariant(variant: ReviewReactionVariant) -> Bool {
    reviewReactionLottieAssetConfigurations.contains { assetConfiguration in
        assetConfiguration.variant == variant
    }
}

func reviewReactionLottieAssetConfiguration(
    variant: ReviewReactionVariant
) -> ReviewReactionLottieAssetConfiguration? {
    reviewReactionLottieAssetConfigurations.first { assetConfiguration in
        assetConfiguration.variant == variant
    }
}

func reviewReactionLottieAssetStatus(
    variant: ReviewReactionVariant,
    readiness: ReviewReactionLottieAssetReadiness
) -> ReviewReactionLottieAssetStatus {
    guard isReviewReactionLottieVariant(variant: variant) else {
        return .notLottie
    }
    if readiness.readyVariants.contains(variant) {
        return .ready
    }
    if readiness.failedVariants.contains(variant) {
        return .failed
    }
    if readiness.pendingVariants.contains(variant) {
        return .pending
    }

    preconditionFailure("Review Lottie readiness is missing state for \(variant.debugIdentifier).")
}

func shouldUseReviewReactionCrownFallback(
    variant: ReviewReactionVariant,
    readiness: ReviewReactionLottieAssetReadiness
) -> Bool {
    reviewReactionLottieAssetStatus(variant: variant, readiness: readiness) == .failed
}

private func logReviewReactionLottieAssetFailure(failure: ReviewReactionLottieAssetFailure) {
    reviewReactionLottieAssetLogger.error(
        "Review Lottie asset failed. variant=\(failure.variant.debugIdentifier, privacy: .public) assetName=\(failure.assetName, privacy: .public) assetDescription=\(failure.assetDescription, privacy: .public) failureReason=\(failure.failureReason, privacy: .public) message=\(failure.message, privacy: .public)"
    )
}
