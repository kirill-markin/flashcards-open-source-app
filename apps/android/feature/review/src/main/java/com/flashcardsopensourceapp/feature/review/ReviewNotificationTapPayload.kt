package com.flashcardsopensourceapp.feature.review

import android.util.Log
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import org.json.JSONObject

data class ReviewNotificationTapPayload(
    val workspaceId: String,
    val cardId: String,
    val requestId: String,
    val frontText: String,
    val reviewFilter: ReviewFilter
)

data class ReviewNotificationTapFallback(
    val stage: String,
    val reason: String,
    val workspaceId: String?,
    val currentWorkspaceId: String?,
    val cardId: String?,
    val requestId: String?,
    val details: String?
)

sealed interface ReviewNotificationTapRequest {
    data class Resolved(
        val payload: ReviewNotificationTapPayload
    ) : ReviewNotificationTapRequest

    data class Fallback(
        val fallback: ReviewNotificationTapFallback
    ) : ReviewNotificationTapRequest
}

private const val reviewNotificationLogTag: String = "FlashcardsReviewNotification"

fun logReviewNotificationTapFallback(fallback: ReviewNotificationTapFallback) {
    val record = JSONObject().apply {
        put("domain", "android_notifications")
        put("action", "notification_tap_fallback")
        put("stage", fallback.stage)
        put("reason", fallback.reason)
        put("workspaceId", fallback.workspaceId)
        put("currentWorkspaceId", fallback.currentWorkspaceId)
        put("cardId", fallback.cardId)
        put("requestId", fallback.requestId)
        put("details", fallback.details)
    }
    Log.e(reviewNotificationLogTag, record.toString())
}
