package com.flashcardsopensourceapp.data.local.notifications

/**
 * Identifies why review reminders are being reconciled.
 *
 * [APP_ACTIVE], [REVIEW_RECORDED], and [WORKSPACE_CHANGED] clear delivered
 * system notifications.
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
    WORKSPACE_CHANGED(shouldClearDeliveredReviewNotifications = true)
}
