package com.flashcardsopensourceapp.data.local.review

import android.content.Context

private const val storeReviewRequestPreferencesName: String = "flashcards-store-review-request"
private const val lastStoreReviewRequestedAtKey: String = "last-store-review-requested-at"
private const val lastStoreReviewRequestedAppVersionKey: String = "last-store-review-requested-app-version"

data class StoreReviewRequestState(
    val lastStoreReviewRequestedAt: Long?,
    val lastStoreReviewRequestedAppVersion: String?
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
