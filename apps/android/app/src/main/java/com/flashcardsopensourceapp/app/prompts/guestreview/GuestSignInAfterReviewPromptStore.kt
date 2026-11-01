package com.flashcardsopensourceapp.app.prompts.guestreview

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

const val guestSignInAfterReviewPromptPreferencesName: String =
    "guest_sign_in_after_review_prompt_preferences"

private const val lastShownAtMillisKey: String = "lastShownAtMillis"

interface GuestSignInAfterReviewPromptStore {
    fun loadLastShownAtMillis(): Long?
    fun recordShown(nowMillis: Long)
    fun clearLastShownAt()
}

class SharedPreferencesGuestSignInAfterReviewPromptStore(
    context: Context
) : GuestSignInAfterReviewPromptStore {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        guestSignInAfterReviewPromptPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadLastShownAtMillis(): Long? {
        if (preferences.contains(lastShownAtMillisKey).not()) {
            return null
        }

        return preferences.getLong(lastShownAtMillisKey, 0L)
    }

    override fun recordShown(nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(lastShownAtMillisKey, nowMillis)
        }
    }

    override fun clearLastShownAt() {
        preferences.edit(commit = true) {
            remove(lastShownAtMillisKey)
        }
    }
}
