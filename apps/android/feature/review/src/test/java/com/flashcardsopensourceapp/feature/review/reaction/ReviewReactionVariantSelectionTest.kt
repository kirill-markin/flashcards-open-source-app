package com.flashcardsopensourceapp.feature.review.reaction

import com.flashcardsopensourceapp.data.local.model.ReviewRating
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewReactionVariantSelectionTest {
    @Test
    fun againSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.AGAIN, 0, ReviewReactionVariant.AGAIN_WORM_WIGGLE)
        assertSelectedVariant(ReviewRating.AGAIN, 39, ReviewReactionVariant.AGAIN_WORM_WIGGLE)
        assertSelectedVariant(ReviewRating.AGAIN, 40, ReviewReactionVariant.AGAIN_TORNADO)
        assertSelectedVariant(ReviewRating.AGAIN, 69, ReviewReactionVariant.AGAIN_TORNADO)
        assertSelectedVariant(ReviewRating.AGAIN, 70, ReviewReactionVariant.AGAIN_SNAIL_CRAWL)
        assertSelectedVariant(ReviewRating.AGAIN, 91, ReviewReactionVariant.AGAIN_SNAIL_CRAWL)
        assertSelectedVariant(ReviewRating.AGAIN, 92, ReviewReactionVariant.AGAIN_WILTED_FLOWER)
        assertSelectedVariant(ReviewRating.AGAIN, 99, ReviewReactionVariant.AGAIN_WILTED_FLOWER)
    }

    @Test
    fun hardSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.HARD, 0, ReviewReactionVariant.HARD_OX_CHARGE)
        assertSelectedVariant(ReviewRating.HARD, 39, ReviewReactionVariant.HARD_OX_CHARGE)
        assertSelectedVariant(ReviewRating.HARD, 40, ReviewReactionVariant.HARD_PAW_PRINTS)
        assertSelectedVariant(ReviewRating.HARD, 69, ReviewReactionVariant.HARD_PAW_PRINTS)
        assertSelectedVariant(ReviewRating.HARD, 70, ReviewReactionVariant.HARD_RACEHORSE_GALLOP)
        assertSelectedVariant(ReviewRating.HARD, 91, ReviewReactionVariant.HARD_RACEHORSE_GALLOP)
        assertSelectedVariant(ReviewRating.HARD, 92, ReviewReactionVariant.HARD_VOLCANO_ERUPTION)
        assertSelectedVariant(ReviewRating.HARD, 99, ReviewReactionVariant.HARD_VOLCANO_ERUPTION)
    }

    @Test
    fun goodSelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.GOOD, 0, ReviewReactionVariant.GOOD_OWL)
        assertSelectedVariant(ReviewRating.GOOD, 39, ReviewReactionVariant.GOOD_OWL)
        assertSelectedVariant(ReviewRating.GOOD, 40, ReviewReactionVariant.GOOD_POODLE)
        assertSelectedVariant(ReviewRating.GOOD, 69, ReviewReactionVariant.GOOD_POODLE)
        assertSelectedVariant(ReviewRating.GOOD, 70, ReviewReactionVariant.GOOD_WHALE)
        assertSelectedVariant(ReviewRating.GOOD, 91, ReviewReactionVariant.GOOD_WHALE)
        assertSelectedVariant(ReviewRating.GOOD, 92, ReviewReactionVariant.GOOD_PEACOCK)
        assertSelectedVariant(ReviewRating.GOOD, 99, ReviewReactionVariant.GOOD_PEACOCK)
    }

    @Test
    fun easySelectionUsesConfiguredBoundaries() {
        assertSelectedVariant(ReviewRating.EASY, 0, ReviewReactionVariant.EASY_ROSE_BLOOM)
        assertSelectedVariant(ReviewRating.EASY, 39, ReviewReactionVariant.EASY_ROSE_BLOOM)
        assertSelectedVariant(ReviewRating.EASY, 40, ReviewReactionVariant.EASY_RAINBOW_STREAK)
        assertSelectedVariant(ReviewRating.EASY, 69, ReviewReactionVariant.EASY_RAINBOW_STREAK)
        assertSelectedVariant(ReviewRating.EASY, 70, ReviewReactionVariant.EASY_PHOENIX_RISE)
        assertSelectedVariant(ReviewRating.EASY, 91, ReviewReactionVariant.EASY_PHOENIX_RISE)
        assertSelectedVariant(ReviewRating.EASY, 92, ReviewReactionVariant.EASY_UNICORN_FLYBY)
        assertSelectedVariant(ReviewRating.EASY, 99, ReviewReactionVariant.EASY_UNICORN_FLYBY)
    }

    @Test
    fun probabilityPercentagesUseWeights() {
        val expectedPercentages: List<Double> = listOf(40.0, 30.0, 22.0, 8.0)

        listOf(
            ReviewRating.AGAIN,
            ReviewRating.HARD,
            ReviewRating.GOOD,
            ReviewRating.EASY
        ).forEach { rating: ReviewRating ->
            assertEquals(
                expectedPercentages,
                reviewReactionVariantDistributionEntries(rating = rating)
                    .map { entry: ReviewReactionVariantDistributionEntry -> entry.probabilityPercent }
            )
        }
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
            variant = ReviewReactionVariant.HARD_OX_CHARGE
        )
        val thirdEvent = makeTestReactionEvent(
            id = "reaction-3",
            rating = ReviewRating.GOOD,
            variant = ReviewReactionVariant.GOOD_OWL
        )
        val fourthEvent = makeTestReactionEvent(
            id = "reaction-4",
            rating = ReviewRating.EASY,
            variant = ReviewReactionVariant.EASY_ROSE_BLOOM
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
