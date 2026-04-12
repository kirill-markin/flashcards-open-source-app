package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRole

internal const val aiChatStalenessThresholdMillis: Long = 6L * 60L * 60L * 1000L

internal fun lastUserMessageTimestampMillis(
    messages: List<AiChatMessage>
): Long? {
    val lastUserMessage = messages.lastOrNull { message ->
        message.role == AiChatRole.USER
    } ?: return null
    return lastUserMessage.timestampMillis
}

internal fun isAiChatConversationStale(
    messages: List<AiChatMessage>,
    nowMillis: Long
): Boolean {
    val lastUserMessageTimestamp = lastUserMessageTimestampMillis(messages = messages) ?: return false
    return nowMillis - lastUserMessageTimestamp > aiChatStalenessThresholdMillis
}
