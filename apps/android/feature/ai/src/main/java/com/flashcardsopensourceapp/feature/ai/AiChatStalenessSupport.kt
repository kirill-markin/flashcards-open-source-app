package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
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

internal fun shouldAutoOpenFreshConversation(
    state: AiChatRuntimeState,
    nowMillis: Long
): Boolean {
    if (state.conversationBootstrapState != AiConversationBootstrapState.READY) {
        return false
    }
    if (state.composerPhase != AiComposerPhase.IDLE) {
        return false
    }
    if (state.dictationState != AiChatDictationState.IDLE) {
        return false
    }
    if (state.activeRun != null) {
        return false
    }

    return isAiChatConversationStale(
        messages = state.persistedState.messages,
        nowMillis = nowMillis
    )
}

internal fun shouldAutoOpenFreshConversationForEntry(
    currentState: AiChatRuntimeState,
    persistedMessages: List<AiChatMessage>,
    nowMillis: Long
): Boolean {
    if (currentState.conversationBootstrapState != AiConversationBootstrapState.READY) {
        return false
    }
    if (currentState.composerPhase != AiComposerPhase.IDLE) {
        return false
    }
    if (currentState.dictationState != AiChatDictationState.IDLE) {
        return false
    }
    if (currentState.activeRun != null) {
        return false
    }

    return isAiChatConversationStale(
        messages = persistedMessages,
        nowMillis = nowMillis
    )
}
