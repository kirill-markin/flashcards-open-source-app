package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewFilter

data class ReviewNotificationTapPayload(
    val workspaceId: String,
    val cardId: String,
    val requestId: String,
    val frontText: String,
    val reviewFilter: ReviewFilter
)
