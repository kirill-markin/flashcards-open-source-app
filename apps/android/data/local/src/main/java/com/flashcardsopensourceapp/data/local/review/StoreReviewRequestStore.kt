package com.flashcardsopensourceapp.data.local.review

import android.content.Context
import com.flashcardsopensourceapp.data.local.database.review.ReviewLogDao
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

const val storeReviewRequestMinimumCurrentDayReviewCount: Int = 5
const val storeReviewRequestCooldownMillis: Long = 90L * 24L * 60L * 60L * 1000L

private const val storeReviewRequestPreferencesName: String = "flashcards-store-review-request"
private const val lastStoreReviewRequestedAtKey: String = "last-store-review-requested-at"
private const val lastStoreReviewRequestedAppVersionKey: String = "last-store-review-requested-app-version"

data class StoreReviewRequestState(
    val lastStoreReviewRequestedAt: Long?,
    val lastStoreReviewRequestedAppVersion: String?
)

enum class StoreReviewRequestIneligibilityReason {
    NO_PREVIOUS_LOCAL_DAY_REVIEW_ACTIVITY,
    CURRENT_LOCAL_DAY_REVIEW_COUNT_BELOW_THRESHOLD,
    RECENT_REQUEST_ATTEMPT,
    CURRENT_APP_VERSION_ALREADY_REQUESTED
}

data class StoreReviewRequestEligibility(
    val isEligible: Boolean,
    val ineligibilityReason: StoreReviewRequestIneligibilityReason?
)

data class StoreReviewLocalDateWindow(
    val startMillis: Long,
    val endMillis: Long
)

interface StoreReviewRequestStore {
    fun loadState(): StoreReviewRequestState
    fun saveRequestAttempt(requestedAtMillis: Long, appVersion: String)
    fun clearRequestAttempt()
}

class SharedPreferencesStoreReviewRequestStore(
    context: Context
) : StoreReviewRequestStore {
    private val preferences = context.getSharedPreferences(
        storeReviewRequestPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadState(): StoreReviewRequestState {
        val lastRequestedAtMillis = if (preferences.contains(lastStoreReviewRequestedAtKey)) {
            preferences.getLong(lastStoreReviewRequestedAtKey, 0L)
        } else {
            null
        }
        require(lastRequestedAtMillis == null || lastRequestedAtMillis > 0L) {
            "Persisted store review request timestamp is invalid. " +
                "preferencesName=$storeReviewRequestPreferencesName " +
                "key=$lastStoreReviewRequestedAtKey value=$lastRequestedAtMillis"
        }

        val rawLastRequestedAppVersion = preferences.getString(lastStoreReviewRequestedAppVersionKey, null)
        val lastRequestedAppVersion = rawLastRequestedAppVersion?.trim()
        require(lastRequestedAppVersion == null || lastRequestedAppVersion.isNotEmpty()) {
            "Persisted store review request app version is blank. " +
                "preferencesName=$storeReviewRequestPreferencesName key=$lastStoreReviewRequestedAppVersionKey"
        }

        return StoreReviewRequestState(
            lastStoreReviewRequestedAt = lastRequestedAtMillis,
            lastStoreReviewRequestedAppVersion = lastRequestedAppVersion
        )
    }

    override fun saveRequestAttempt(requestedAtMillis: Long, appVersion: String) {
        val normalizedAppVersion = appVersion.trim()
        require(normalizedAppVersion.isNotEmpty()) {
            "Store review request app version must not be blank."
        }
        val didCommit = preferences.edit()
            .putLong(lastStoreReviewRequestedAtKey, requestedAtMillis)
            .putString(lastStoreReviewRequestedAppVersionKey, normalizedAppVersion)
            .commit()
        check(didCommit) {
            "Failed to persist store review request attempt. " +
                "preferencesName=$storeReviewRequestPreferencesName " +
                "requestedAtMillis=$requestedAtMillis appVersion=$normalizedAppVersion"
        }
    }

    override fun clearRequestAttempt() {
        val didCommit = preferences.edit()
            .remove(lastStoreReviewRequestedAtKey)
            .remove(lastStoreReviewRequestedAppVersionKey)
            .commit()
        check(didCommit) {
            "Failed to clear store review request state. preferencesName=$storeReviewRequestPreferencesName"
        }
    }
}

suspend fun determineStoreReviewRequestEligibility(
    reviewLogDao: ReviewLogDao,
    storeReviewRequestStore: StoreReviewRequestStore,
    nowMillis: Long,
    zoneId: ZoneId,
    appVersion: String
): StoreReviewRequestEligibility {
    val normalizedAppVersion = appVersion.trim()
    require(normalizedAppVersion.isNotEmpty()) {
        "Store review request app version must not be blank."
    }

    val currentLocalDate = Instant.ofEpochMilli(nowMillis)
        .atZone(zoneId)
        .toLocalDate()
    val currentDateWindow = buildStoreReviewLocalDateWindow(
        localDate = currentLocalDate,
        zoneId = zoneId
    )
    val state = storeReviewRequestStore.loadState()

    if (
        reviewLogDao.hasReviewLogsBefore(
            endMillis = currentDateWindow.startMillis
        ).not()
    ) {
        return ineligibleStoreReviewRequest(
            reason = StoreReviewRequestIneligibilityReason.NO_PREVIOUS_LOCAL_DAY_REVIEW_ACTIVITY
        )
    }

    val currentDayReviewCount = reviewLogDao.countReviewLogsBetween(
        startMillis = currentDateWindow.startMillis,
        endMillis = currentDateWindow.endMillis
    )
    if (currentDayReviewCount < storeReviewRequestMinimumCurrentDayReviewCount) {
        return ineligibleStoreReviewRequest(
            reason = StoreReviewRequestIneligibilityReason.CURRENT_LOCAL_DAY_REVIEW_COUNT_BELOW_THRESHOLD
        )
    }

    if (
        isStoreReviewRequestOnCooldown(
            lastRequestedAtMillis = state.lastStoreReviewRequestedAt,
            nowMillis = nowMillis
        )
    ) {
        return ineligibleStoreReviewRequest(
            reason = StoreReviewRequestIneligibilityReason.RECENT_REQUEST_ATTEMPT
        )
    }

    if (
        state.lastStoreReviewRequestedAppVersion == normalizedAppVersion
    ) {
        return ineligibleStoreReviewRequest(
            reason = StoreReviewRequestIneligibilityReason.CURRENT_APP_VERSION_ALREADY_REQUESTED
        )
    }

    return StoreReviewRequestEligibility(
        isEligible = true,
        ineligibilityReason = null
    )
}

fun buildStoreReviewLocalDateWindow(
    localDate: LocalDate,
    zoneId: ZoneId
): StoreReviewLocalDateWindow {
    val startOfDay = localDate.atStartOfDay(zoneId)
    val startOfNextDay = localDate.plusDays(1L).atStartOfDay(zoneId)
    return StoreReviewLocalDateWindow(
        startMillis = startOfDay.toInstant().toEpochMilli(),
        endMillis = startOfNextDay.toInstant().toEpochMilli()
    )
}

fun isStoreReviewRequestOnCooldown(
    lastRequestedAtMillis: Long?,
    nowMillis: Long
): Boolean {
    if (lastRequestedAtMillis == null) {
        return false
    }

    return nowMillis - lastRequestedAtMillis < storeReviewRequestCooldownMillis
}

private fun ineligibleStoreReviewRequest(
    reason: StoreReviewRequestIneligibilityReason
): StoreReviewRequestEligibility {
    return StoreReviewRequestEligibility(
        isEligible = false,
        ineligibilityReason = reason
    )
}
