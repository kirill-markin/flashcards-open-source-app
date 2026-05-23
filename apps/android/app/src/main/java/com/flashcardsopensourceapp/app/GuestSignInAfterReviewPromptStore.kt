package com.flashcardsopensourceapp.app

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

const val guestSignInAfterReviewPromptPreferencesName: String =
    "guest_sign_in_after_review_prompt_preferences"

private const val lastShownAtMillisKey: String = "lastShownAtMillis"
private const val snoozedUntilMillisKey: String = "snoozedUntilMillis"
private const val lastShownReviewCountKey: String = "lastShownReviewCount"
private const val acceptedAtMillisKey: String = "acceptedAtMillis"

interface GuestSignInAfterReviewPromptStore {
    fun loadState(): GuestSignInAfterReviewPromptState
    fun recordShown(nowMillis: Long, reviewCount: Int)
    fun recordSnoozed(nowMillis: Long, reviewCount: Int)
    fun recordAccepted(nowMillis: Long)
}

class SharedPreferencesGuestSignInAfterReviewPromptStore(
    context: Context
) : GuestSignInAfterReviewPromptStore {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        guestSignInAfterReviewPromptPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadState(): GuestSignInAfterReviewPromptState {
        return GuestSignInAfterReviewPromptState(
            lastShownAtMillis = loadLongOrNull(key = lastShownAtMillisKey),
            snoozedUntilMillis = loadLongOrNull(key = snoozedUntilMillisKey),
            lastShownReviewCount = loadIntOrNull(key = lastShownReviewCountKey),
            acceptedAtMillis = loadLongOrNull(key = acceptedAtMillisKey)
        )
    }

    override fun recordShown(nowMillis: Long, reviewCount: Int) {
        preferences.edit(commit = true) {
            putLong(lastShownAtMillisKey, nowMillis)
            putInt(lastShownReviewCountKey, reviewCount)
        }
    }

    override fun recordSnoozed(nowMillis: Long, reviewCount: Int) {
        preferences.edit(commit = true) {
            putLong(snoozedUntilMillisKey, nowMillis + guestSignInAfterReviewPromptSnoozeMillis)
            putInt(lastShownReviewCountKey, reviewCount)
        }
    }

    override fun recordAccepted(nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(acceptedAtMillisKey, nowMillis)
        }
    }

    private fun loadLongOrNull(key: String): Long? {
        if (preferences.contains(key).not()) {
            return null
        }

        return preferences.getLong(key, 0L)
    }

    private fun loadIntOrNull(key: String): Int? {
        if (preferences.contains(key).not()) {
            return null
        }

        return preferences.getInt(key, 0)
    }
}
