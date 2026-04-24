package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import java.time.Instant
import java.time.ZoneId

internal const val marketingScreenshotExpectedStreakDays: Int = 8
internal const val marketingScreenshotExpectedActiveReviewDays: Int = 16

private data class MarketingReviewTimestamp(
    val daysAgo: Long,
    val hour: Int,
    val minute: Int
)

private data class MarketingSupportCardReviewPlan(
    val supportCardIndex: Int,
    val reviewDayOffsets: List<Long>
)

internal fun marketingUnifiedRepositorySeedScenario(
    localeConfig: MarketingScreenshotLocaleConfig,
    nowMillis: Long
): RepositorySeedScenario {
    val supportCardReviewPlans: List<MarketingSupportCardReviewPlan> =
        marketingSupportCardReviewPlans()
    validateMarketingUnifiedScreenshotFixtures(
        localeConfig = localeConfig,
        supportCardReviewPlans = supportCardReviewPlans
    )
    return RepositorySeedScenario(
        cards = marketingSupportCardsSeedCards(
            localeConfig = localeConfig,
            supportCardReviewPlans = supportCardReviewPlans,
            nowMillis = nowMillis
        ) +
            marketingSharedReviewSeedCard(localeConfig = localeConfig)
    )
}

private fun validateMarketingUnifiedScreenshotFixtures(
    localeConfig: MarketingScreenshotLocaleConfig,
    supportCardReviewPlans: List<MarketingSupportCardReviewPlan>
) {
    require(localeConfig.cards.isNotEmpty()) {
        "Marketing review/cards screenshot requires at least one cards fixture."
    }
    require(localeConfig.cards.first().frontText == localeConfig.reviewCard.frontText) {
        "Marketing review/cards screenshot requires the first cards fixture to share the review prompt."
    }
    require(localeConfig.cards.drop(1).none { card -> card.frontText == localeConfig.reviewCard.frontText }) {
        "Marketing review/cards screenshot supports exactly one shared review/cards prompt."
    }

    val cardsListTag: String = localeConfig.cards.first().subjectTag
    require(localeConfig.reviewCard.tags == listOf(cardsListTag)) {
        "Marketing review/cards screenshot requires matching review/cards tags. " +
            "ReviewTags=${localeConfig.reviewCard.tags} CardsTag=$cardsListTag"
    }

    val supportCards = localeConfig.cards.drop(1)
    require(supportCards.size >= supportCardReviewPlans.size) {
        "Unified Android marketing screenshot seed requires at least ${supportCardReviewPlans.size} support cards. " +
            "Provided=${supportCards.size}"
    }

    val activeReviewDayOffsets: Set<Long> = supportCardReviewPlans
        .flatMap(MarketingSupportCardReviewPlan::reviewDayOffsets)
        .toSet()
    require(activeReviewDayOffsets.size == marketingScreenshotExpectedActiveReviewDays) {
        "Unified Android marketing screenshot seed must use exactly $marketingScreenshotExpectedActiveReviewDays active review days. " +
            "Resolved=${activeReviewDayOffsets.size} Offsets=${activeReviewDayOffsets.sorted()}"
    }

    val expectedStreakDayOffsets: Set<Long> =
        (0 until marketingScreenshotExpectedStreakDays).map(Int::toLong).toSet()
    require(activeReviewDayOffsets.containsAll(expectedStreakDayOffsets)) {
        "Unified Android marketing screenshot seed must include a final streak of $marketingScreenshotExpectedStreakDays days. " +
            "ResolvedOffsets=${activeReviewDayOffsets.sorted()}"
    }
    require(activeReviewDayOffsets.contains(marketingScreenshotExpectedStreakDays.toLong()).not()) {
        "Unified Android marketing screenshot seed must stop the current streak at exactly $marketingScreenshotExpectedStreakDays days. " +
            "ResolvedOffsets=${activeReviewDayOffsets.sorted()}"
    }
}

private fun marketingSupportCardReviewPlans(): List<MarketingSupportCardReviewPlan> {
    return listOf(
        MarketingSupportCardReviewPlan(
            supportCardIndex = 0,
            reviewDayOffsets = listOf(29L, 18L, 7L, 0L)
        ),
        MarketingSupportCardReviewPlan(
            supportCardIndex = 1,
            reviewDayOffsets = listOf(27L, 16L, 6L, 0L)
        ),
        MarketingSupportCardReviewPlan(
            supportCardIndex = 2,
            reviewDayOffsets = listOf(24L, 14L, 5L, 0L)
        ),
        MarketingSupportCardReviewPlan(
            supportCardIndex = 3,
            reviewDayOffsets = listOf(22L, 4L, 1L, 0L)
        ),
        MarketingSupportCardReviewPlan(
            supportCardIndex = 4,
            reviewDayOffsets = listOf(20L, 3L, 0L)
        ),
        MarketingSupportCardReviewPlan(
            supportCardIndex = 5,
            reviewDayOffsets = listOf(2L, 0L)
        )
    )
}

private fun marketingSupportCardsSeedCards(
    localeConfig: MarketingScreenshotLocaleConfig,
    supportCardReviewPlans: List<MarketingSupportCardReviewPlan>,
    nowMillis: Long
): List<RepositorySeedCard> {
    val zoneId: ZoneId = ZoneId.systemDefault()
    val supportCards: List<MarketingConceptCard> = localeConfig.cards.drop(1)
    return supportCardReviewPlans.map { reviewPlan ->
        val card: MarketingConceptCard = supportCards[reviewPlan.supportCardIndex]
        RepositorySeedCard(
            frontText = card.frontText,
            backText = card.backText,
            tags = listOf(card.subjectTag),
            effortLevel = EffortLevel.MEDIUM,
            reviews = reviewPlan.reviewDayOffsets.sortedDescending().map { daysAgo ->
                RepositorySeedReview(
                    rating = marketingReviewRatingForDayOffset(daysAgo = daysAgo),
                    reviewedAtMillis = resolveMarketingReviewTimestampMillis(
                        nowMillis = nowMillis,
                        zoneId = zoneId,
                        reviewTimestamp = resolveMarketingReviewTimestamp(
                            supportCardIndex = reviewPlan.supportCardIndex,
                            daysAgo = daysAgo
                        )
                    )
                )
            }
        )
    }
}

private fun marketingSharedReviewSeedCard(
    localeConfig: MarketingScreenshotLocaleConfig
): RepositorySeedCard {
    return RepositorySeedCard(
        frontText = localeConfig.reviewCard.frontText,
        backText = localeConfig.reviewCard.backText,
        tags = localeConfig.reviewCard.tags,
        effortLevel = EffortLevel.MEDIUM,
        reviews = emptyList()
    )
}

private fun resolveMarketingReviewTimestamp(
    supportCardIndex: Int,
    daysAgo: Long
): MarketingReviewTimestamp {
    return MarketingReviewTimestamp(
        daysAgo = daysAgo,
        hour = 6 + supportCardIndex,
        minute = 10 + supportCardIndex * 7
    )
}

private fun marketingReviewRatingForDayOffset(
    daysAgo: Long
): ReviewRating {
    return if (daysAgo == 0L) {
        ReviewRating.EASY
    } else {
        ReviewRating.GOOD
    }
}

private fun resolveMarketingReviewTimestampMillis(
    nowMillis: Long,
    zoneId: ZoneId,
    reviewTimestamp: MarketingReviewTimestamp
): Long {
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)
    val startOfTodayMillis: Long = now.toLocalDate()
        .atStartOfDay(zoneId)
        .toInstant()
        .toEpochMilli()
    val scheduledReview: Long = now.toLocalDate()
        .minusDays(reviewTimestamp.daysAgo)
        .atTime(reviewTimestamp.hour, reviewTimestamp.minute)
        .atZone(zoneId)
        .toInstant()
        .toEpochMilli()
    if (scheduledReview < nowMillis) {
        return scheduledReview
    }

    require(reviewTimestamp.daysAgo == 0L) {
        "Resolved marketing review timestamp must be in the past. nowMillis=$nowMillis scheduledReview=$scheduledReview"
    }
    val fallbackReviewMillis: Long = now.minusSeconds(1).toInstant().toEpochMilli()
    return if (fallbackReviewMillis >= startOfTodayMillis) {
        fallbackReviewMillis
    } else {
        startOfTodayMillis
    }
}
