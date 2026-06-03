package com.flashcardsopensourceapp.data.local.model.progress

data class CloudDailyReviewPoint(
    val date: String,
    val reviewCount: Int
)

data class CloudProgressSummary(
    val currentStreakDays: Int,
    val hasReviewedToday: Boolean,
    val lastReviewedOn: String?,
    val activeReviewDays: Int
)

data class CloudProgressSeries(
    val timeZone: String,
    val from: String,
    val to: String,
    val dailyReviews: List<CloudDailyReviewPoint>,
    val generatedAt: String?,
    val summary: CloudProgressSummary?
)

enum class ProgressReviewScheduleBucketKey(
    val wireKey: String
) {
    NEW("new"),
    TODAY("today"),
    DAYS_1_TO_7("days1To7"),
    DAYS_8_TO_30("days8To30"),
    DAYS_31_TO_90("days31To90"),
    DAYS_91_TO_360("days91To360"),
    YEARS_1_TO_2("years1To2"),
    LATER("later");

    companion object {
        val orderedEntries: List<ProgressReviewScheduleBucketKey> = listOf(
            NEW,
            TODAY,
            DAYS_1_TO_7,
            DAYS_8_TO_30,
            DAYS_31_TO_90,
            DAYS_91_TO_360,
            YEARS_1_TO_2,
            LATER
        )

        fun fromWireKey(wireKey: String): ProgressReviewScheduleBucketKey {
            return orderedEntries.firstOrNull { key -> key.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown review schedule bucket key '$wireKey'.")
        }
    }
}

data class CloudProgressReviewScheduleBucket(
    val key: ProgressReviewScheduleBucketKey,
    val count: Int
)

data class CloudProgressReviewSchedule(
    val timeZone: String,
    val generatedAt: String?,
    val totalCards: Int,
    val buckets: List<CloudProgressReviewScheduleBucket>
)
