package com.flashcardsopensourceapp.feature.ai

data class AiConversationScrollState(
    val isNearBottom: Boolean,
    val isUserScrolling: Boolean
)

fun aiConversationScrollState(
    totalItemsCount: Int,
    lastVisibleItemIndex: Int,
    isUserScrolling: Boolean,
    bottomThreshold: Int
): AiConversationScrollState {
    if (totalItemsCount <= 0) {
        return AiConversationScrollState(
            isNearBottom = true,
            isUserScrolling = isUserScrolling
        )
    }

    val distanceToBottom = (totalItemsCount - 1) - lastVisibleItemIndex
    return AiConversationScrollState(
        isNearBottom = distanceToBottom <= bottomThreshold,
        isUserScrolling = isUserScrolling
    )
}
