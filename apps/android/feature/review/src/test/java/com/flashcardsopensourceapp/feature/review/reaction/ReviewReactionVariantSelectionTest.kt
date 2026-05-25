package com.flashcardsopensourceapp.feature.review.reaction

import com.flashcardsopensourceapp.data.local.model.ReviewRating
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewReactionVariantSelectionTest {
    @Test
    fun againSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.AGAIN, 0, ReviewReactionVariant.AGAIN_WORM_WIGGLE)
        assertSelectedVariant(ReviewRating.AGAIN, 399, ReviewReactionVariant.AGAIN_WORM_WIGGLE)
        assertSelectedVariant(ReviewRating.AGAIN, 400, ReviewReactionVariant.AGAIN_REWIND_VORTEX)
        assertSelectedVariant(ReviewRating.AGAIN, 699, ReviewReactionVariant.AGAIN_REWIND_VORTEX)
        assertSelectedVariant(ReviewRating.AGAIN, 700, ReviewReactionVariant.AGAIN_SNAIL_CRAWL)
        assertSelectedVariant(ReviewRating.AGAIN, 919, ReviewReactionVariant.AGAIN_SNAIL_CRAWL)
        assertSelectedVariant(ReviewRating.AGAIN, 920, ReviewReactionVariant.AGAIN_WARNING_TAPE)
        assertSelectedVariant(ReviewRating.AGAIN, 999, ReviewReactionVariant.AGAIN_WARNING_TAPE)
    }

    @Test
    fun hardSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.HARD, 0, ReviewReactionVariant.HARD_HOURGLASS_SAND)
        assertSelectedVariant(ReviewRating.HARD, 399, ReviewReactionVariant.HARD_HOURGLASS_SAND)
        assertSelectedVariant(ReviewRating.HARD, 400, ReviewReactionVariant.HARD_FALLING_WEIGHT)
        assertSelectedVariant(ReviewRating.HARD, 699, ReviewReactionVariant.HARD_FALLING_WEIGHT)
        assertSelectedVariant(ReviewRating.HARD, 700, ReviewReactionVariant.HARD_YELLOW_CRACK)
        assertSelectedVariant(ReviewRating.HARD, 919, ReviewReactionVariant.HARD_YELLOW_CRACK)
        assertSelectedVariant(ReviewRating.HARD, 920, ReviewReactionVariant.HARD_ROLLING_BOULDER)
        assertSelectedVariant(ReviewRating.HARD, 999, ReviewReactionVariant.HARD_ROLLING_BOULDER)
    }

    @Test
    fun goodSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.GOOD, 0, ReviewReactionVariant.GOOD_OWL)
        assertSelectedVariant(ReviewRating.GOOD, 399, ReviewReactionVariant.GOOD_OWL)
        assertSelectedVariant(ReviewRating.GOOD, 400, ReviewReactionVariant.GOOD_POODLE)
        assertSelectedVariant(ReviewRating.GOOD, 699, ReviewReactionVariant.GOOD_POODLE)
        assertSelectedVariant(ReviewRating.GOOD, 700, ReviewReactionVariant.GOOD_WHALE)
        assertSelectedVariant(ReviewRating.GOOD, 919, ReviewReactionVariant.GOOD_WHALE)
        assertSelectedVariant(ReviewRating.GOOD, 920, ReviewReactionVariant.GOOD_PEACOCK)
        assertSelectedVariant(ReviewRating.GOOD, 999, ReviewReactionVariant.GOOD_PEACOCK)
    }

    @Test
    fun easySelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.EASY, 0, ReviewReactionVariant.EASY_SPARKLE_BURST)
        assertSelectedVariant(ReviewRating.EASY, 399, ReviewReactionVariant.EASY_SPARKLE_BURST)
        assertSelectedVariant(ReviewRating.EASY, 400, ReviewReactionVariant.EASY_RAINBOW_STREAK)
        assertSelectedVariant(ReviewRating.EASY, 699, ReviewReactionVariant.EASY_RAINBOW_STREAK)
        assertSelectedVariant(ReviewRating.EASY, 700, ReviewReactionVariant.EASY_CROWN_BOUNCE)
        assertSelectedVariant(ReviewRating.EASY, 919, ReviewReactionVariant.EASY_CROWN_BOUNCE)
        assertSelectedVariant(ReviewRating.EASY, 920, ReviewReactionVariant.EASY_UNICORN_FLYBY)
        assertSelectedVariant(ReviewRating.EASY, 999, ReviewReactionVariant.EASY_UNICORN_FLYBY)
    }

    @Test
    fun appendReactionEventDropsOldestWhenMaximumIsExceeded() {
        val firstEvent = makeTestReactionEvent(
            id = "reaction-1",
            rating = ReviewRating.AGAIN,
            variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE
        )
        val secondEvent = makeTestReactionEvent(
            id = "reaction-2",
            rating = ReviewRating.HARD,
            variant = ReviewReactionVariant.HARD_HOURGLASS_SAND
        )
        val thirdEvent = makeTestReactionEvent(
            id = "reaction-3",
            rating = ReviewRating.GOOD,
            variant = ReviewReactionVariant.GOOD_OWL
        )
        val fourthEvent = makeTestReactionEvent(
            id = "reaction-4",
            rating = ReviewRating.EASY,
            variant = ReviewReactionVariant.EASY_SPARKLE_BURST
        )

        val result = appendReviewReactionEvent(
            events = listOf(firstEvent, secondEvent, thirdEvent),
            event = fourthEvent,
            maximumActiveEvents = 3
        )

        assertEquals(listOf(secondEvent, thirdEvent, fourthEvent), result)
    }
}

private fun assertSelectedVariant(
    rating: ReviewRating,
    roll: Int,
    expectedVariant: ReviewReactionVariant
) {
    assertEquals(
        expectedVariant,
        selectReviewReactionVariant(rating = rating, roll = roll)
    )
}

private fun makeTestReactionEvent(
    id: String,
    rating: ReviewRating,
    variant: ReviewReactionVariant
): ReviewReactionEvent {
    return ReviewReactionEvent(
        id = id,
        rating = rating,
        variant = variant
    )
}
