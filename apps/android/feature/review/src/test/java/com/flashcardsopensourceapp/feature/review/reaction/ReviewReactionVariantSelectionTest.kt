package com.flashcardsopensourceapp.feature.review.reaction

import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private data class ExpectedReviewReactionDistribution(
    val rating: ReviewRating,
    val entries: List<ExpectedReviewReactionDistributionEntry>
)

private data class ExpectedReviewReactionDistributionEntry(
    val variant: ReviewReactionVariant,
    val weight: Int
)

private val expectedReviewReactionDistributions: List<ExpectedReviewReactionDistribution> = listOf(
    ExpectedReviewReactionDistribution(
        rating = ReviewRating.AGAIN,
        entries = listOf(
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_RAIN_CLOUD, 32),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_TORNADO, 26),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_WIND_FACE, 24),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_SNOWFLAKE, 18),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_SNAIL_CRAWL, 18),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_TURTLE, 16),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_WILTED_FLOWER, 12),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_SPIDER, 8),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_RAT, 8),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.AGAIN_WORM_WIGGLE, 6)
        )
    ),
    ExpectedReviewReactionDistribution(
        rating = ReviewRating.HARD,
        entries = listOf(
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_TIGER, 32),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_T_REX, 26),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_SHARK, 22),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_OX_CHARGE, 20),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_RACEHORSE_GALLOP, 18),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_SNAKE, 16),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_VOLCANO_ERUPTION, 14),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_SCORPION, 10),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_PAW_PRINTS, 8),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.HARD_ROOSTER, 8)
        )
    ),
    ExpectedReviewReactionDistribution(
        rating = ReviewRating.GOOD,
        entries = listOf(
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_OTTER, 32),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_OWL, 28),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_RABBIT, 26),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_SEAL, 24),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_SERVICE_DOG, 24),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_POODLE, 20),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_CHIMPANZEE, 18),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_WHALE, 16),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_PEACOCK, 12),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.GOOD_PIG, 10)
        )
    ),
    ExpectedReviewReactionDistribution(
        rating = ReviewRating.EASY,
        entries = listOf(
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_SUNRISE, 34),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_SUNRISE_OVER_MOUNTAINS, 34),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_ROSE_BLOOM, 30),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_PEACE, 28),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_PLANT, 26),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_RAINBOW_STREAK, 24),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_PHOENIX_RISE, 18),
            ExpectedReviewReactionDistributionEntry(ReviewReactionVariant.EASY_UNICORN_FLYBY, 12)
        )
    )
)

class ReviewReactionVariantSelectionTest {
    @Test
    fun selectionUsesConfiguredBoundaries() {
        expectedReviewReactionDistributions.forEach { distribution: ExpectedReviewReactionDistribution ->
            var startRoll = 0
            distribution.entries.forEach { entry: ExpectedReviewReactionDistributionEntry ->
                val endRoll = startRoll + entry.weight - 1
                assertSelectedVariant(distribution.rating, startRoll, entry.variant)
                assertSelectedVariant(distribution.rating, endRoll, entry.variant)
                startRoll += entry.weight
            }
        }
    }

    @Test
    fun probabilityPercentagesUseWeights() {
        expectedReviewReactionDistributions.forEach { distribution: ExpectedReviewReactionDistribution ->
            val totalWeight: Int = distribution.entries.sumOf { entry: ExpectedReviewReactionDistributionEntry ->
                entry.weight
            }
            val expectedPercentages: List<Double> = distribution.entries.map { entry: ExpectedReviewReactionDistributionEntry ->
                entry.weight.toDouble() / totalWeight.toDouble() * 100.0
            }

            assertEquals(
                expectedPercentages,
                reviewReactionVariantDistributionEntries(rating = distribution.rating)
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

    @Test
    fun pendingCompositionDoesNotUseCrownFallback() {
        assertNull(
            reviewReactionFallbackVariantForReadiness(
                readiness = ReviewReactionLottieReadiness.Pending
            )
        )
    }

    @Test
    fun failedCompositionUsesCrownFallback() {
        assertEquals(
            ReviewReactionVariant.FALLBACK_CROWN_BOUNCE,
            reviewReactionFallbackVariantForReadiness(
                readiness = ReviewReactionLottieReadiness.Failed(
                    error = IllegalStateException("Missing test composition.")
                )
            )
        )
    }

    @Test
    fun readySelectionSkipsEventWhenRatingHasNoReadyVariants() {
        assertNull(
            makeReviewReactionEventForReadyVariants(
                id = "reaction-1",
                rating = ReviewRating.GOOD,
                preferredVariant = ReviewReactionVariant.GOOD_OWL,
                readyVariants = emptySet(),
                replacementRoll = 0
            )
        )
    }

    @Test
    fun readySelectionReplacesUnavailablePreferredVariantWithReadyVariant() {
        val result: ReviewReactionEvent? = makeReviewReactionEventForReadyVariants(
            id = "reaction-1",
            rating = ReviewRating.AGAIN,
            preferredVariant = ReviewReactionVariant.AGAIN_RAIN_CLOUD,
            readyVariants = setOf(
                ReviewReactionVariant.AGAIN_TURTLE,
                ReviewReactionVariant.AGAIN_WORM_WIGGLE
            ),
            replacementRoll = 16
        )

        assertEquals(
            makeTestReactionEvent(
                id = "reaction-1",
                rating = ReviewRating.AGAIN,
                variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE
            ),
            result
        )
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
