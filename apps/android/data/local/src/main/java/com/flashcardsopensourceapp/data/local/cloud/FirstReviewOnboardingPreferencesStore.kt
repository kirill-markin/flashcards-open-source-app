package com.flashcardsopensourceapp.data.local.cloud

import android.content.SharedPreferences

private const val valueKey = "first-review-onboarding-completed"
private const val ownerKey = "first-review-onboarding-owner"
private const val generationKey = "first-review-onboarding-generation"
private const val pendingKey = "first-review-onboarding-pending"
private const val initializedKey = "first-review-onboarding-initialized"
private const val provisionalKey = "first-review-onboarding-provisional"

internal data class PendingFirstReviewOnboardingEdit(
    val owner: String,
    val generation: Long,
    val completed: Boolean
)

internal class FirstReviewOnboardingPreferencesStore(private val preferences: SharedPreferences) {
    fun currentOwner(): String? = preferences.getString(ownerKey, null)

    fun isOwner(owner: String): Boolean = currentOwner() == owner

    fun currentValue(): Boolean? = if (preferences.contains(valueKey)) {
        preferences.getBoolean(valueKey, false)
    } else {
        null
    }

    fun initialize(owner: String, hasHistory: Boolean, isLocalGuest: Boolean) {
        val storedOwner = preferences.getString(ownerKey, null)
        if (storedOwner != null && storedOwner != owner) changeOwner(owner, false)
        if (preferences.getBoolean(initializedKey, false)) {
            if (storedOwner == null) commit(preferences.edit().putString(ownerKey, owner))
            return
        }
        val editor = preferences.edit().putString(ownerKey, owner).putBoolean(initializedKey, true)
        if (hasHistory || isLocalGuest) editor.putBoolean(valueKey, hasHistory)
        if (hasHistory) editor.putBoolean(provisionalKey, true)
        commit(editor)
    }

    fun changeOwner(owner: String, isNewGuestBinding: Boolean) {
        val previousOwner = preferences.getString(ownerKey, null)
        if (previousOwner == owner) return
        val editor = preferences.edit().putString(ownerKey, owner)
        if (!isNewGuestBinding) {
            editor.remove(valueKey).remove(pendingKey).remove(initializedKey).remove(provisionalKey)
        }
        // Generation never resets: an in-flight reply must not acknowledge a later identity.
        editor.putLong(generationKey, preferences.getLong(generationKey, 0) + 1)
        commit(editor)
    }

    fun reconcile(remote: Boolean?): Boolean? {
        if (!preferences.getBoolean(pendingKey, false) && remote != null) {
            commit(preferences.edit().putBoolean(valueKey, remote).putBoolean(initializedKey, true).remove(provisionalKey))
        }
        return currentValue()
    }

    fun save(completed: Boolean): Boolean {
        val previousValue = currentValue()
        if (previousValue == completed && !preferences.getBoolean(provisionalKey, false)) return false
        commit(preferences.edit()
            .remove(provisionalKey)
            .putBoolean(valueKey, completed)
            .putBoolean(initializedKey, true)
            .putBoolean(pendingKey, true)
            .putLong(generationKey, preferences.getLong(generationKey, 0) + 1))
        return previousValue != null && previousValue != completed
    }

    fun pendingEdit(): PendingFirstReviewOnboardingEdit? {
        if (!preferences.getBoolean(pendingKey, false)) return null
        return PendingFirstReviewOnboardingEdit(
            owner = requireNotNull(preferences.getString(ownerKey, null)),
            generation = preferences.getLong(generationKey, 0),
            completed = requireNotNull(currentValue())
        )
    }

    fun acknowledge(edit: PendingFirstReviewOnboardingEdit) {
        if (pendingEdit() != edit) return
        commit(preferences.edit().remove(pendingKey))
    }

    fun clear() {
        commit(preferences.edit().remove(valueKey).remove(ownerKey).remove(pendingKey)
            .remove(initializedKey).remove(provisionalKey).putLong(generationKey, preferences.getLong(generationKey, 0) + 1))
    }

    private fun commit(editor: SharedPreferences.Editor) {
        check(editor.commit()) { "Could not persist first review onboarding preference on this device." }
    }
}
