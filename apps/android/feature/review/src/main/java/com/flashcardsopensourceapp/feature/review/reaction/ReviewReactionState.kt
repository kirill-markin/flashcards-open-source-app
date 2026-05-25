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
    HARD_OX_CHARGE,
    HARD_PAW_PRINTS,
    HARD_RACEHORSE_GALLOP,
    HARD_VOLCANO_ERUPTION,
    GOOD_OWL,
    GOOD_POODLE,
    GOOD_WHALE,
    GOOD_PEACOCK,
    EASY_ROSE_BLOOM,
    EASY_RAINBOW_STREAK,
    EASY_PHOENIX_RISE,
    EASY_UNICORN_FLYBY,
    FALLBACK_CROWN_BOUNCE
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
        ReviewReactionVariant.HARD_OX_CHARGE -> "hardOxCharge"
        ReviewReactionVariant.HARD_PAW_PRINTS -> "hardPawPrints"
        ReviewReactionVariant.HARD_RACEHORSE_GALLOP -> "hardRacehorseGallop"
        ReviewReactionVariant.HARD_VOLCANO_ERUPTION -> "hardVolcanoEruption"
        ReviewReactionVariant.GOOD_OWL -> "goodOwl"
        ReviewReactionVariant.GOOD_POODLE -> "goodPoodle"
        ReviewReactionVariant.GOOD_WHALE -> "goodWhale"
        ReviewReactionVariant.GOOD_PEACOCK -> "goodPeacock"
        ReviewReactionVariant.EASY_ROSE_BLOOM -> "easyRoseBloom"
        ReviewReactionVariant.EASY_RAINBOW_STREAK -> "easyRainbowStreak"
        ReviewReactionVariant.EASY_PHOENIX_RISE -> "easyPhoenixRise"
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> "easyUnicornFlyby"
        ReviewReactionVariant.FALLBACK_CROWN_BOUNCE -> "fallbackCrownBounce"
    }

internal data class ReviewReactionVariantDistributionEntry(
    val rating: ReviewRating,
    val variant: ReviewReactionVariant,
    val weight: Int
) {
    val id: String
        get() = "${rating.reviewReactionDebugIdentifier}.${variant.debugIdentifier}"

    val probabilityPercent: Double
        get() = weight.toDouble() / reviewReactionVariantTotalWeight(rating = rating).toDouble() * 100.0
}

internal val allReviewReactionVariantDistributionEntries: List<ReviewReactionVariantDistributionEntry> = listOf(
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        weight = 40
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_TORNADO,
        weight = 30
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        weight = 22
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.AGAIN,
        variant = ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        weight = 8
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_OX_CHARGE,
        weight = 40
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_PAW_PRINTS,
        weight = 30
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_RACEHORSE_GALLOP,
        weight = 22
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.HARD,
        variant = ReviewReactionVariant.HARD_VOLCANO_ERUPTION,
        weight = 8
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_OWL,
        weight = 40
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_POODLE,
        weight = 30
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_WHALE,
        weight = 22
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.GOOD,
        variant = ReviewReactionVariant.GOOD_PEACOCK,
        weight = 8
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_ROSE_BLOOM,
        weight = 40
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_RAINBOW_STREAK,
        weight = 30
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_PHOENIX_RISE,
        weight = 22
    ),
    ReviewReactionVariantDistributionEntry(
        rating = ReviewRating.EASY,
        variant = ReviewReactionVariant.EASY_UNICORN_FLYBY,
        weight = 8
    )
)

internal fun reviewReactionVariantDistributionEntries(
    rating: ReviewRating
): List<ReviewReactionVariantDistributionEntry> {
    return allReviewReactionVariantDistributionEntries.filter { entry: ReviewReactionVariantDistributionEntry ->
        entry.rating == rating
    }
}

internal fun reviewReactionVariantTotalWeight(rating: ReviewRating): Int {
    val entries: List<ReviewReactionVariantDistributionEntry> = reviewReactionVariantDistributionEntries(rating = rating)
    require(entries.isNotEmpty()) {
        "Review reaction distribution is missing a rating. rating=${rating.reviewReactionDebugIdentifier}"
    }

    var totalWeight = 0
    entries.forEach { entry: ReviewReactionVariantDistributionEntry ->
        require(entry.weight > 0) {
            "Review reaction weight must be positive. entryId=${entry.id} weight=${entry.weight}"
        }
        totalWeight += entry.weight
    }

    return totalWeight
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
    val entries: List<ReviewReactionVariantDistributionEntry> = reviewReactionVariantDistributionEntries(rating = rating)
    val totalWeight: Int = reviewReactionVariantTotalWeight(rating = rating)
    require(roll in 0 until totalWeight) {
        "Review reaction roll must be in 0 until $totalWeight, received $roll."
    }

    var cumulativeWeight = 0
    for (entry in entries) {
        cumulativeWeight += entry.weight
        if (roll < cumulativeWeight) {
            return entry.variant
        }
    }

    error(
        "Review reaction distribution is missing a variant. " +
            "rating=${rating.reviewReactionDebugIdentifier} roll=$roll"
    )
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
    val totalWeight: Int = reviewReactionVariantTotalWeight(rating = rating)
    val roll: Int = Random.nextInt(from = 0, until = totalWeight)
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
        ReviewReactionVariant.HARD_RACEHORSE_GALLOP -> 1_200
        ReviewReactionVariant.EASY_ROSE_BLOOM -> 2_400
        ReviewReactionVariant.GOOD_PEACOCK -> 1_333
        ReviewReactionVariant.AGAIN_TORNADO -> 1_450
        ReviewReactionVariant.HARD_OX_CHARGE -> 1_550
        ReviewReactionVariant.HARD_PAW_PRINTS,
        ReviewReactionVariant.FALLBACK_CROWN_BOUNCE -> 1_650
        ReviewReactionVariant.EASY_RAINBOW_STREAK -> 2_000
        ReviewReactionVariant.HARD_VOLCANO_ERUPTION -> 2_050
        ReviewReactionVariant.AGAIN_WILTED_FLOWER -> 2_400
        ReviewReactionVariant.GOOD_WHALE -> 2_633
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL -> 2_700
        ReviewReactionVariant.GOOD_POODLE -> 2_800
        ReviewReactionVariant.GOOD_OWL -> 2_833
        ReviewReactionVariant.EASY_PHOENIX_RISE -> 3_933
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> 3_800
        ReviewReactionVariant.AGAIN_WORM_WIGGLE -> 4_267
    }
}
