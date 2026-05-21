package com.flashcardsopensourceapp.feature.review

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
    AGAIN_RED_SCRIBBLE_SLASH,
    AGAIN_REWIND_VORTEX,
    AGAIN_STAMP_FLYBY,
    AGAIN_WARNING_TAPE,
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

    return when (rating) {
        ReviewRating.AGAIN -> {
            if (roll <= 399) {
                ReviewReactionVariant.AGAIN_RED_SCRIBBLE_SLASH
            } else if (roll <= 699) {
                ReviewReactionVariant.AGAIN_REWIND_VORTEX
            } else if (roll <= 919) {
                ReviewReactionVariant.AGAIN_STAMP_FLYBY
            } else {
                ReviewReactionVariant.AGAIN_WARNING_TAPE
            }
        }

        ReviewRating.HARD -> {
            if (roll <= 399) {
                ReviewReactionVariant.HARD_HOURGLASS_SAND
            } else if (roll <= 699) {
                ReviewReactionVariant.HARD_FALLING_WEIGHT
            } else if (roll <= 919) {
                ReviewReactionVariant.HARD_YELLOW_CRACK
            } else {
                ReviewReactionVariant.HARD_ROLLING_BOULDER
            }
        }

        ReviewRating.GOOD -> {
            if (roll <= 399) {
                ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK
            } else if (roll <= 699) {
                ReviewReactionVariant.GOOD_LIGHT_SWEEP
            } else if (roll <= 919) {
                ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK
            } else {
                ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE
            }
        }

        ReviewRating.EASY -> {
            if (roll <= 399) {
                ReviewReactionVariant.EASY_SPARKLE_BURST
            } else if (roll <= 699) {
                ReviewReactionVariant.EASY_RAINBOW_STREAK
            } else if (roll <= 919) {
                ReviewReactionVariant.EASY_CROWN_BOUNCE
            } else {
                ReviewReactionVariant.EASY_UNICORN_FLYBY
            }
        }
    }
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
        ReviewReactionVariant.AGAIN_RED_SCRIBBLE_SLASH,
        ReviewReactionVariant.HARD_YELLOW_CRACK -> 1_200
        ReviewReactionVariant.EASY_SPARKLE_BURST -> 1_250
        ReviewReactionVariant.AGAIN_REWIND_VORTEX,
        ReviewReactionVariant.GOOD_LIGHT_SWEEP,
        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE -> 1_450
        ReviewReactionVariant.HARD_HOURGLASS_SAND,
        ReviewReactionVariant.AGAIN_WARNING_TAPE,
        ReviewReactionVariant.EASY_RAINBOW_STREAK -> 1_550
        ReviewReactionVariant.HARD_FALLING_WEIGHT,
        ReviewReactionVariant.EASY_CROWN_BOUNCE -> 1_650
        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK -> 1_750
        ReviewReactionVariant.AGAIN_STAMP_FLYBY -> 1_900
        ReviewReactionVariant.HARD_ROLLING_BOULDER -> 2_050
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> 2_150
    }
}
