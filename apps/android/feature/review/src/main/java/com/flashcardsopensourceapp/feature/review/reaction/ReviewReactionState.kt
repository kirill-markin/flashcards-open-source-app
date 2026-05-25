package com.flashcardsopensourceapp.feature.review.reaction

import android.animation.ValueAnimator
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import java.util.UUID
import kotlin.random.Random

internal const val reviewReactionMaximumActiveEvents: Int = 3

private const val reviewReactionReducedMotionDurationMillis: Int = 340

internal enum class ReviewReactionMotionMode {
    STANDARD,
    REDUCED
}

internal enum class ReviewReactionVariant {
    AGAIN_WORM_WIGGLE,
    AGAIN_TORNADO,
    AGAIN_SNAIL_CRAWL,
    AGAIN_WILTED_FLOWER,
    HARD_HOURGLASS_SAND,
    HARD_FALLING_WEIGHT,
    HARD_YELLOW_CRACK,
    HARD_ROLLING_BOULDER,
    GOOD_HAND_DRAWN_CHECK,
    GOOD_LIGHT_SWEEP,
    GOOD_PAPER_PLANE_CHECK,
    GOOD_CHECK_SEAL_BOUNCE,
    EASY_SPARKLE_BURST,
    EASY_RAINBOW_STREAK,
    EASY_CROWN_BOUNCE,
    EASY_UNICORN_FLYBY
}

internal val ReviewRating.reviewReactionDebugIdentifier: String
    get() = when (this) {
        ReviewRating.AGAIN -> "again"
        ReviewRating.HARD -> "hard"
        ReviewRating.GOOD -> "good"
        ReviewRating.EASY -> "easy"
    }

internal val ReviewReactionVariant.debugIdentifier: String
    get() = when (this) {
        ReviewReactionVariant.AGAIN_WORM_WIGGLE -> "againWormWiggle"
        ReviewReactionVariant.AGAIN_TORNADO -> "againTornado"
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL -> "againSnailCrawl"
        ReviewReactionVariant.AGAIN_WILTED_FLOWER -> "againWiltedFlower"
        ReviewReactionVariant.HARD_HOURGLASS_SAND -> "hardHourglassSand"
        ReviewReactionVariant.HARD_FALLING_WEIGHT -> "hardFallingWeight"
        ReviewReactionVariant.HARD_YELLOW_CRACK -> "hardYellowCrack"
        ReviewReactionVariant.HARD_ROLLING_BOULDER -> "hardRollingBoulder"
        ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK -> "goodHandDrawnCheck"
        ReviewReactionVariant.GOOD_LIGHT_SWEEP -> "goodLightSweep"
        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK -> "goodPaperPlaneCheck"
        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE -> "goodCheckSealBounce"
        ReviewReactionVariant.EASY_SPARKLE_BURST -> "easySparkleBurst"
        ReviewReactionVariant.EASY_RAINBOW_STREAK -> "easyRainbowStreak"
        ReviewReactionVariant.EASY_CROWN_BOUNCE -> "easyCrownBounce"
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> "easyUnicornFlyby"
    }

internal data class ReviewReactionVariantDistributionEntry(
    val rating: ReviewRating,
    val variant: ReviewReactionVariant,
    val rollRange: IntRange
) {
    val id: String
        get() = "${rating.reviewReactionDebugIdentifier}.${variant.debugIdentifier}"

    val rollCount: Int
        get() = rollRange.last - rollRange.first + 1

    val probabilityPercent: Int
        get() = rollCount / 10
}

internal val allReviewReactionVariantDistributionEntries: List<ReviewReactionVariantDistributionEntry> = listOf(
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        rollRange = 0..399
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_TORNADO,
        rollRange = 400..699
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        rollRange = 700..919
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        rollRange = 920..999
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_HOURGLASS_SAND,
        rollRange = 0..399
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_FALLING_WEIGHT,
        rollRange = 400..699
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_YELLOW_CRACK,
        rollRange = 700..919
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_ROLLING_BOULDER,
        rollRange = 920..999
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK,
        rollRange = 0..399
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_LIGHT_SWEEP,
        rollRange = 400..699
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK,
        rollRange = 700..919
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE,
        rollRange = 920..999
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_SPARKLE_BURST,
        rollRange = 0..399
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_RAINBOW_STREAK,
        rollRange = 400..699
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_CROWN_BOUNCE,
        rollRange = 700..919
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_UNICORN_FLYBY,
        rollRange = 920..999
    )
)

internal fun reviewReactionVariantDistributionEntries(
    rating: ReviewRating
): List<ReviewReactionVariantDistributionEntry> {
    return allReviewReactionVariantDistributionEntries.filter { entry: ReviewReactionVariantDistributionEntry ->
        entry.rating == rating
    }
}

internal data class ReviewReactionEvent(
    val id: String,
    val rating: ReviewRating,
    val variant: ReviewReactionVariant
)

internal fun selectReviewReactionVariant(
    rating: ReviewRating,
    roll: Int
): ReviewReactionVariant {
    require(roll in 0..999) {
        "Review reaction roll must be in 0..999, received $roll."
    }

    val matchingEntry: ReviewReactionVariantDistributionEntry =
        reviewReactionVariantDistributionEntries(rating = rating).firstOrNull { entry: ReviewReactionVariantDistributionEntry ->
            roll in entry.rollRange
        } ?: error(
            "Review reaction distribution is missing a variant. " +
                "rating=${rating.reviewReactionDebugIdentifier} roll=$roll"
        )

    return matchingEntry.variant
}

internal fun appendReviewReactionEvent(
    events: List<ReviewReactionEvent>,
    event: ReviewReactionEvent,
    maximumActiveEvents: Int
): List<ReviewReactionEvent> {
    require(maximumActiveEvents > 0) {
        "Review reactions require at least one active event slot."
    }

    val nextEvents: List<ReviewReactionEvent> = events + event
    if (nextEvents.size <= maximumActiveEvents) {
        return nextEvents
    }

    return nextEvents.takeLast(n = maximumActiveEvents)
}

internal fun reviewReactionMotionModeFromAnimatorSettings(): ReviewReactionMotionMode {
    return if (ValueAnimator.areAnimatorsEnabled()) {
        ReviewReactionMotionMode.STANDARD
    } else {
        ReviewReactionMotionMode.REDUCED
    }
}

internal fun makeRandomReviewReactionEvent(rating: ReviewRating): ReviewReactionEvent {
    val roll: Int = Random.nextInt(from = 0, until = 1_000)
    return ReviewReactionEvent(
        id = UUID.randomUUID().toString(),
        rating = rating,
        variant = selectReviewReactionVariant(rating = rating, roll = roll)
    )
}

internal fun reviewReactionAnimationDurationMillis(
    variant: ReviewReactionVariant,
    motionMode: ReviewReactionMotionMode
): Int {
    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        return reviewReactionReducedMotionDurationMillis
    }

    return when (variant) {
        ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK -> 1_150
        ReviewReactionVariant.HARD_YELLOW_CRACK -> 1_200
        ReviewReactionVariant.EASY_SPARKLE_BURST -> 1_250
        ReviewReactionVariant.AGAIN_TORNADO,
        ReviewReactionVariant.GOOD_LIGHT_SWEEP,
        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE -> 1_450
        ReviewReactionVariant.HARD_HOURGLASS_SAND -> 1_550
        ReviewReactionVariant.HARD_FALLING_WEIGHT,
        ReviewReactionVariant.EASY_CROWN_BOUNCE -> 1_650
        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK -> 1_750
        ReviewReactionVariant.EASY_RAINBOW_STREAK -> 2_000
        ReviewReactionVariant.HARD_ROLLING_BOULDER -> 2_050
        ReviewReactionVariant.AGAIN_WILTED_FLOWER -> 2_400
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL -> 2_700
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> 3_800
        ReviewReactionVariant.AGAIN_WORM_WIGGLE -> 4_267
    }
}
