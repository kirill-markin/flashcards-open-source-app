package com.flashcardsopensourceapp.data.local.notifications

/**
 * Identifies why strict reminders are being reconciled.
 *
 * Only [APP_ACTIVE] clears already-delivered strict reminders from the
 * notification shade. The remaining triggers reconcile pending work only.
 */
enum class StrictRemindersReconcileTrigger(
    val shouldClearDeliveredStrictReminders: Boolean
) {
    APP_ACTIVE(shouldClearDeliveredStrictReminders = true),
    APP_BACKGROUND(shouldClearDeliveredStrictReminders = false),
    SETTINGS_CHANGED(shouldClearDeliveredStrictReminders = false),
    PERMISSION_CHANGED(shouldClearDeliveredStrictReminders = false),
    REVIEW_RECORDED(shouldClearDeliveredStrictReminders = false),
    REVIEW_HISTORY_IMPORTED(shouldClearDeliveredStrictReminders = false)
}
