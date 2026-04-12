package com.flashcardsopensourceapp.feature.ai.ui

import androidx.compose.foundation.lazy.LazyListLayoutInfo

internal const val aiConversationAutoScrollBottomThresholdPx: Int = 24

data class AiConversationScrollState(
    val isNearBottom: Boolean
)

/**
 * Measures proximity from the rendered bottom edge so in-place content growth does not
 * look like the user intentionally detached from the conversation.
 */
fun aiConversationScrollState(
    layoutInfo: LazyListLayoutInfo,
    bottomThresholdPx: Int
): AiConversationScrollState {
    if (layoutInfo.totalItemsCount <= 0) {
        return AiConversationScrollState(isNearBottom = true)
    }

    val lastVisibleItem = layoutInfo.visibleItemsInfo.lastOrNull()
        ?: return AiConversationScrollState(isNearBottom = true)

    val lastItemIndex = layoutInfo.totalItemsCount - 1
    if (lastVisibleItem.index < lastItemIndex) {
        return AiConversationScrollState(isNearBottom = false)
    }

    val renderedBottom = lastVisibleItem.offset + lastVisibleItem.size
    val distanceToBottom = (layoutInfo.viewportEndOffset - renderedBottom).coerceAtLeast(0)
    return AiConversationScrollState(
        isNearBottom = distanceToBottom <= bottomThresholdPx
    )
}
