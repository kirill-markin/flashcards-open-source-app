package com.flashcardsopensourceapp.data.local.notifications

/**
 * Identifies why review reminders are being reconciled.
 *
 * [APP_ACTIVE] clears already-delivered reminders because the user has returned
 * to the app and the previous reminders have served their purpose. [REVIEW_RECORDED]
 * also clears them because the moment a card is reviewed, any "review reminder"
 * notification (and the launcher icon badge it carries) is no longer relevant.
 * The remaining triggers only reconcile pending work and scheduled payloads.
 */
enum class ReviewNotificationsReconcileTrigger(
    val shouldClearDeliveredReviewNotifications: Boolean
) {
    APP_ACTIVE(shouldClearDeliveredReviewNotifications = true),
    APP_BACKGROUND(shouldClearDeliveredReviewNotifications = false),
    SETTINGS_CHANGED(shouldClearDeliveredReviewNotifications = false),
    PERMISSION_CHANGED(shouldClearDeliveredReviewNotifications = false),
    REVIEW_RECORDED(shouldClearDeliveredReviewNotifications = true),
    FILTER_CHANGED(shouldClearDeliveredReviewNotifications = false),
    WORKSPACE_CHANGED(shouldClearDeliveredReviewNotifications = false)
}
