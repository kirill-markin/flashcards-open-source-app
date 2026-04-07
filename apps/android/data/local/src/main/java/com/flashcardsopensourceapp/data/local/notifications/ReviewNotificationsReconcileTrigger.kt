package com.flashcardsopensourceapp.data.local.notifications

/**
 * Identifies why review reminders are being reconciled.
 *
 * Only [APP_ACTIVE] clears already-delivered reminders from the notification shade.
 * The remaining triggers only reconcile pending work and scheduled payloads.
 */
enum class ReviewNotificationsReconcileTrigger(
    val shouldClearDeliveredReviewNotifications: Boolean
) {
    APP_ACTIVE(shouldClearDeliveredReviewNotifications = true),
    APP_BACKGROUND(shouldClearDeliveredReviewNotifications = false),
    SETTINGS_CHANGED(shouldClearDeliveredReviewNotifications = false),
    PERMISSION_CHANGED(shouldClearDeliveredReviewNotifications = false),
    REVIEW_RECORDED(shouldClearDeliveredReviewNotifications = false),
    FILTER_CHANGED(shouldClearDeliveredReviewNotifications = false),
    WORKSPACE_CHANGED(shouldClearDeliveredReviewNotifications = false)
}
