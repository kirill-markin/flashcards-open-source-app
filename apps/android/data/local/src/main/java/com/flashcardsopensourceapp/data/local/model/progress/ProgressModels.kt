package com.flashcardsopensourceapp.data.local.model.progress

data class CloudDailyReviewPoint(
    val date: String,
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int
) {
    init {
        require(reviewCount >= 0) {
            "Daily review point '$date' reviewCount must not be negative."
        }
        require(againCount >= 0) {
            "Daily review point '$date' againCount must not be negative."
        }
        require(hardCount >= 0) {
            "Daily review point '$date' hardCount must not be negative."
        }
        require(goodCount >= 0) {
            "Daily review point '$date' goodCount must not be negative."
        }
        require(easyCount >= 0) {
            "Daily review point '$date' easyCount must not be negative."
        }

        val ratingCountTotal = againCount + hardCount + goodCount + easyCount
        require(reviewCount == ratingCountTotal) {
            "Daily review point '$date' reviewCount must equal rating count sum $ratingCountTotal."
        }
    }
}

enum class CloudProgressStreakDayState(
    val wireKey: String
) {
    REVIEWED("reviewed"),
    FROZEN("frozen"),
    MISSED("missed"),
    PENDING("pending");

    companion object {
        private val orderedEntries: List<CloudProgressStreakDayState> = listOf(
            REVIEWED,
            FROZEN,
            MISSED,
            PENDING
        )

        fun fromWireKey(wireKey: String): CloudProgressStreakDayState {
            return orderedEntries.firstOrNull { state -> state.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown progress streak day state '$wireKey'.")
        }
    }
}

data class CloudProgressStreakDay(
    val date: String,
    val state: CloudProgressStreakDayState
)

data class CloudProgressStreakFreeze(
    val availableCredits: Int,
    val capacity: Int,
    val balanceUnits: Int,
    val unitsPerCredit: Int,
    val nextCreditProgressUnits: Int,
    val nextCreditRequiredUnits: Int
)

data class ProgressReviewHistoryWatermark(
    val workspaceId: String,
    val reviewSequenceId: Long
)

data class CloudProgressSummary(
    val currentStreakDays: Int,
    val longestStreakDays: Int,
    val hasReviewedToday: Boolean,
    val lastReviewedOn: String?,
    val activeReviewDays: Int,
    val streakFreeze: CloudProgressStreakFreeze,
    val reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>
)

data class CloudProgressSeries(
    val timeZone: String,
    val from: String,
    val to: String,
    val dailyReviews: List<CloudDailyReviewPoint>,
    val streakDays: List<CloudProgressStreakDay>,
    val generatedAt: String?,
    val reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>,
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
    val reviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>,
    val totalCards: Int,
    val buckets: List<CloudProgressReviewScheduleBucket>
)
