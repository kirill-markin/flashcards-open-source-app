package com.flashcardsopensourceapp.data.local.model.progress

enum class ProgressLeaderboardProfileStatus(
    val wireKey: String
) {
    READY("ready"),
    LINKED_ACCOUNT_REQUIRED("linked_account_required"),
    PARTICIPATION_DISABLED("participation_disabled"),
    PROFILE_UNAVAILABLE("profile_unavailable");

    companion object {
        fun fromWireKey(wireKey: String): ProgressLeaderboardProfileStatus {
            return entries.firstOrNull { status -> status.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard profile status '$wireKey'.")
        }
    }
}

enum class ProgressLeaderboardProfileReviewActivityDateBasis(
    val wireKey: String
) {
    PROFILE_LOCAL_DAY_WITH_UTC_FALLBACK("profile_local_day_with_utc_fallback");

    companion object {
        fun fromWireKey(wireKey: String): ProgressLeaderboardProfileReviewActivityDateBasis {
            return entries.firstOrNull { basis -> basis.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown leaderboard profile review activity date basis '$wireKey'.")
        }
    }
}

data class CloudProgressLeaderboardProfileBestRatingPlacement(
    val windowKey: ProgressLeaderboardWindowKey,
    val rank: Int
)

data class CloudProgressLeaderboardProfileMetrics(
    val currentStreakDays: Int,
    val bestRatingPlacement: CloudProgressLeaderboardProfileBestRatingPlacement?
)

data class CloudProgressLeaderboardProfileReviewActivityDay(
    val date: String,
    val reviewCount: Int
)

data class CloudProgressLeaderboardProfileReviewActivity(
    val dateBasis: ProgressLeaderboardProfileReviewActivityDateBasis,
    val days: List<CloudProgressLeaderboardProfileReviewActivityDay>
)

data class CloudProgressLeaderboardProfileStats(
    val joinedAt: String,
    val totalCards: Int
)

sealed interface CloudProgressLeaderboardProfile {
    val status: ProgressLeaderboardProfileStatus

    data class Ready(
        override val status: ProgressLeaderboardProfileStatus,
        val publicProfileId: String,
        val anonymousDisplayName: String,
        val friendDisplayName: String?,
        val isFriend: Boolean,
        val metrics: CloudProgressLeaderboardProfileMetrics,
        val reviewActivity: CloudProgressLeaderboardProfileReviewActivity,
        val stats: CloudProgressLeaderboardProfileStats,
        val generatedAt: String
    ) : CloudProgressLeaderboardProfile {
        init {
            require(status == ProgressLeaderboardProfileStatus.READY) {
                "Ready leaderboard profile payload must use ready status."
            }
        }
    }

    data class NonReady(
        override val status: ProgressLeaderboardProfileStatus
    ) : CloudProgressLeaderboardProfile {
        init {
            require(status != ProgressLeaderboardProfileStatus.READY) {
                "Non-ready leaderboard profile payload must not use ready status."
            }
        }
    }
}
