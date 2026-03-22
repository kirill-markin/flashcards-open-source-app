package com.flashcardsopensourceapp.feature.ai

data class AiMessage(
    val messageId: String,
    val author: String,
    val text: String
)

data class AiUiState(
    val messages: List<AiMessage>,
    val draftMessage: String,
    val isSending: Boolean
)
