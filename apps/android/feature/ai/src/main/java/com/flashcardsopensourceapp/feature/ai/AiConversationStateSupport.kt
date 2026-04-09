package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusToken
import java.util.UUID

internal fun makeUserMessage(
    content: List<AiChatContentPart>,
    timestampMillis: Long
): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.USER,
        content = content,
        timestampMillis = timestampMillis,
        isError = false,
        isStopped = false,
        cursor = null,
        itemId = null
    )
}

internal fun makeAssistantStatusMessage(timestampMillis: Long): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.ASSISTANT,
        content = listOf(
            AiChatContentPart.Text(text = aiChatOptimisticAssistantStatusToken)
        ),
        timestampMillis = timestampMillis,
        isError = false,
        isStopped = false,
        cursor = null,
        itemId = null
    )
}

internal fun makeUserContent(
    draftMessage: String,
    pendingAttachments: List<AiChatAttachment>
): List<AiChatContentPart> {
    val attachmentContent = pendingAttachments.map(::makeAttachmentContentPart)
    val trimmedMessage = draftMessage.trim()
    if (trimmedMessage.isEmpty()) {
        return attachmentContent
    }

    return attachmentContent + AiChatContentPart.Text(text = trimmedMessage)
}

private fun makeAttachmentContentPart(attachment: AiChatAttachment): AiChatContentPart {
    return when (attachment) {
        is AiChatAttachment.Binary -> {
            if (attachment.isImage) {
                AiChatContentPart.Image(
                    fileName = attachment.fileName,
                    mediaType = attachment.mediaType,
                    base64Data = attachment.base64Data
                )
            } else {
                AiChatContentPart.File(
                    fileName = attachment.fileName,
                    mediaType = attachment.mediaType,
                    base64Data = attachment.base64Data
                )
            }
        }

        is AiChatAttachment.Card -> AiChatContentPart.Card(
            cardId = attachment.cardId,
            frontText = attachment.frontText,
            backText = attachment.backText,
            tags = attachment.tags,
            effortLevel = attachment.effortLevel
        )
        is AiChatAttachment.Unknown -> AiChatContentPart.Unknown(
            originalType = attachment.originalType,
            summaryText = attachment.summaryText,
            rawPayloadJson = attachment.rawPayloadJson
        )
    }
}

internal fun appendTranscriptToDraft(
    currentDraft: String,
    transcript: String
): String {
    val trimmedTranscript = transcript.trim()
    if (trimmedTranscript.isEmpty()) {
        return currentDraft
    }

    val trimmedDraft = currentDraft.trimEnd()
    if (trimmedDraft.isEmpty()) {
        return trimmedTranscript
    }

    return "$trimmedDraft\n$trimmedTranscript"
}

private fun messageHasToolCalls(message: AiChatMessage): Boolean {
    return message.content.any { contentPart -> contentPart is AiChatContentPart.ToolCall }
}

internal fun latestRunHasToolCalls(messages: List<AiChatMessage>): Boolean {
    val latestUserIndex = messages.indexOfLast { message -> message.role == AiChatRole.USER }
    if (latestUserIndex == -1) {
        return false
    }

    return messages.drop(latestUserIndex + 1).any { message ->
        message.role == AiChatRole.ASSISTANT && messageHasToolCalls(message = message)
    }
}

internal fun terminalRunHasToolCalls(messages: List<AiChatMessage>): Boolean {
    if (latestRunHasToolCalls(messages = messages)) {
        return true
    }

    var trailingAssistantItemId: String? = null
    var sawTrailingAssistantMessage = false
    for (message in messages.asReversed()) {
        if (message.role == AiChatRole.USER) {
            return false
        }
        if (message.role == AiChatRole.ASSISTANT) {
            if (sawTrailingAssistantMessage.not()) {
                trailingAssistantItemId = message.itemId
                sawTrailingAssistantMessage = true
            } else if (message.itemId != trailingAssistantItemId) {
                return false
            }
            if (messageHasToolCalls(message = message)) {
                return true
            }
        }
    }

    return false
}

internal fun activeRunTailHasToolCalls(messages: List<AiChatMessage>): Boolean {
    for (message in messages.asReversed()) {
        if (message.role == AiChatRole.USER) {
            return false
        }
        if (message.role == AiChatRole.ASSISTANT) {
            if (messageHasToolCalls(message = message)) {
                return true
            }
            if (message.isStopped) {
                return false
            }
        }
    }

    return false
}

internal fun snapshotRunHasToolCalls(
    activeRun: AiChatActiveRun?,
    messages: List<AiChatMessage>
): Boolean {
    if (activeRun == null) {
        return terminalRunHasToolCalls(messages = messages)
    }

    return activeRunTailHasToolCalls(messages = messages)
}

internal fun setPendingToolRunPostSync(
    state: AiChatPersistedState,
    pendingToolRunPostSync: Boolean
): AiChatPersistedState {
    if (state.pendingToolRunPostSync == pendingToolRunPostSync) {
        return state
    }

    return state.copy(pendingToolRunPostSync = pendingToolRunPostSync)
}

internal fun clearPendingToolRunPostSync(state: AiChatPersistedState): AiChatPersistedState {
    return setPendingToolRunPostSync(
        state = state,
        pendingToolRunPostSync = false
    )
}

internal fun clearOptimisticAssistantStatusIfNeeded(
    state: AiChatPersistedState
): AiChatPersistedState {
    val lastMessage = state.messages.lastOrNull() ?: return state
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val updatedContent = removingOptimisticAssistantStatus(content = lastMessage.content)
    if (updatedContent == lastMessage.content) {
        return state
    }
    if (updatedContent.isEmpty()) {
        return state.copy(messages = state.messages.dropLast(1))
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

internal fun upsertAssistantText(
    state: AiChatPersistedState,
    text: String,
    itemId: String,
    cursor: String
): AiChatPersistedState {
    val resolution = resolveStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    )
    val targetMessage = resolution.state.messages[resolution.index]
    val updatedContent = appendingAssistantTextPart(
        content = targetMessage.content,
        text = text
    )

    return resolution.state.copy(
        messages = resolution.state.messages.replaceAt(
            index = resolution.index,
            value = targetMessage.copy(
                content = updatedContent,
                cursor = cursor,
                itemId = itemId
            )
        )
    )
}

internal fun upsertAssistantToolCall(
    state: AiChatPersistedState,
    toolCall: AiChatToolCall,
    itemId: String,
    cursor: String
): AiChatPersistedState {
    val resolution = resolveStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    )
    val targetMessage = resolution.state.messages[resolution.index]
    val currentContent = removingOptimisticAssistantStatus(content = targetMessage.content)
    val existingIndex = currentContent.indexOfFirst { part ->
        part is AiChatContentPart.ToolCall && part.toolCall.toolCallId == toolCall.toolCallId
    }
    val updatedContent = if (existingIndex == -1) {
        currentContent + AiChatContentPart.ToolCall(toolCall = toolCall)
    } else {
        currentContent.mapIndexed { index, part ->
            if (index == existingIndex) {
                AiChatContentPart.ToolCall(toolCall = toolCall)
            } else {
                part
            }
        }
    }

    return resolution.state.copy(
        messages = resolution.state.messages.replaceAt(
            index = resolution.index,
            value = targetMessage.copy(
                content = updatedContent,
                cursor = cursor,
                itemId = itemId
            )
        )
    )
}

internal fun upsertAssistantReasoningSummary(
    state: AiChatPersistedState,
    reasoningSummary: AiChatReasoningSummary,
    itemId: String,
    cursor: String
): AiChatPersistedState {
    val resolution = resolveStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    )
    val targetMessage = resolution.state.messages[resolution.index]
    val updatedContent = upsertingReasoningSummary(
        content = targetMessage.content,
        reasoningSummary = reasoningSummary
    )

    return resolution.state.copy(
        messages = resolution.state.messages.replaceAt(
            index = resolution.index,
            value = targetMessage.copy(
                content = updatedContent,
                cursor = cursor,
                itemId = itemId
            )
        )
    )
}

internal fun completeAssistantReasoningSummary(
    state: AiChatPersistedState,
    reasoningId: String,
    itemId: String,
    cursor: String
): AiChatPersistedState {
    val resolution = resolveStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    )
    val targetMessage = resolution.state.messages[resolution.index]

    return resolution.state.copy(
        messages = resolution.state.messages.replaceAt(
            index = resolution.index,
            value = targetMessage.copy(
                content = completingReasoningSummary(
                    content = targetMessage.content,
                    reasoningId = reasoningId
                ),
                cursor = cursor,
                itemId = itemId
            )
        )
    )
}

internal fun finalizeAssistantMessage(
    state: AiChatPersistedState,
    content: List<AiChatContentPart>,
    itemId: String,
    cursor: String,
    isError: Boolean,
    isStopped: Boolean
): AiChatPersistedState? {
    val resolution = resolveExistingStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    ) ?: return null
    val finalizedContent = finalizingAssistantContent(content = content)
    if (shouldReconcileAssistantTerminalContent(content = finalizedContent, isError = isError, isStopped = isStopped)) {
        return null
    }
    val targetMessage = resolution.state.messages[resolution.index]

    return resolution.state.copy(
        messages = resolution.state.messages.replaceAt(
            index = resolution.index,
            value = targetMessage.copy(
                content = finalizedContent,
                isError = isError,
                isStopped = isStopped,
                cursor = cursor,
                itemId = itemId
            )
        )
    )
}

internal fun markAssistantError(
    state: AiChatPersistedState,
    message: String,
    timestampMillis: Long
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state.copy(
            messages = listOf(
                AiChatMessage(
                    messageId = UUID.randomUUID().toString().lowercase(),
                    role = AiChatRole.ASSISTANT,
                    content = listOf(AiChatContentPart.Text(text = message)),
                    timestampMillis = timestampMillis,
                    isError = true,
                    isStopped = false,
                    cursor = null,
                    itemId = null
                )
            )
        )
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state.copy(
            messages = state.messages + AiChatMessage(
                messageId = UUID.randomUUID().toString().lowercase(),
                role = AiChatRole.ASSISTANT,
                content = listOf(AiChatContentPart.Text(text = message)),
                timestampMillis = timestampMillis,
                isError = true,
                isStopped = false,
                cursor = null,
                itemId = null
            )
        )
    }

    val currentText = if (isOptimisticAssistantStatus(content = lastMessage.content)) {
        ""
    } else {
        lastMessage.content.filterIsInstance<AiChatContentPart.Text>()
            .joinToString(separator = "") { part -> part.text }
    }
    val separator = if (currentText.isEmpty()) "" else "\n\n"
    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(
            content = appendingAssistantTextPart(
                content = finalizingAssistantContent(content = lastMessage.content),
                text = separator + message
            ),
            isError = true
        )
    )
}

internal fun appendAssistantAccountUpgradePrompt(
    state: AiChatPersistedState,
    message: String,
    buttonTitle: String,
    timestampMillis: Long
): AiChatPersistedState {
    val prompt = AiChatContentPart.AccountUpgradePrompt(
        message = message,
        buttonTitle = buttonTitle
    )

    if (state.messages.isEmpty()) {
        return state.copy(
            messages = listOf(
                AiChatMessage(
                    messageId = UUID.randomUUID().toString().lowercase(),
                    role = AiChatRole.ASSISTANT,
                    content = listOf(prompt),
                    timestampMillis = timestampMillis,
                    isError = false,
                    isStopped = false,
                    cursor = null,
                    itemId = null
                )
            )
        )
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state.copy(
            messages = state.messages + AiChatMessage(
                messageId = UUID.randomUUID().toString().lowercase(),
                role = AiChatRole.ASSISTANT,
                content = listOf(prompt),
                timestampMillis = timestampMillis,
                isError = false,
                isStopped = false,
                cursor = null,
                itemId = null
            )
        )
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(
            content = listOf(prompt),
            isError = false
        )
    )
}

internal fun latestAssistantErrorMessage(messages: List<AiChatMessage>): String? {
    val assistantMessage = messages.lastOrNull { message ->
        message.role == AiChatRole.ASSISTANT && message.isError
    } ?: return null

    val message = assistantMessage.content.filterIsInstance<AiChatContentPart.Text>()
        .joinToString(separator = "") { part -> part.text }
        .trim()

    return message.ifEmpty { null }
}

private fun appendingAssistantTextPart(
    content: List<AiChatContentPart>,
    text: String
): List<AiChatContentPart> {
    if (isOptimisticAssistantStatus(content = content)) {
        return listOf(AiChatContentPart.Text(text = text))
    }

    val textParts = content.filterIsInstance<AiChatContentPart.Text>()
    if (textParts.isEmpty()) {
        return content + AiChatContentPart.Text(text = text)
    }

    val lastTextPart = textParts.last()
    val textIndex = content.indexOfLast { part ->
        part is AiChatContentPart.Text
    }
    return content.mapIndexed { index, part ->
        if (index == textIndex) {
            AiChatContentPart.Text(text = lastTextPart.text + text)
        } else {
            part
        }
    }
}

/**
 * Upserts reasoning blocks without changing the order of the live assistant transcript.
 *
 * The append-on-insert behavior is intentional. Once reasoning arrives after text or
 * other assistant parts, it must stay at that point in the message instead of jumping
 * back to the top and visually reordering the stream.
 */
private fun upsertingReasoningSummary(
    content: List<AiChatContentPart>,
    reasoningSummary: AiChatReasoningSummary
): List<AiChatContentPart> {
    val currentContent = removingOptimisticAssistantStatus(content = content)
    val existingIndex = currentContent.indexOfFirst { part ->
        part is AiChatContentPart.ReasoningSummary
            && part.reasoningSummary.reasoningId == reasoningSummary.reasoningId
    }
    return if (existingIndex == -1) {
        // Keep the live transcript order stable: new reasoning is added where it arrives.
        currentContent + AiChatContentPart.ReasoningSummary(reasoningSummary = reasoningSummary)
    } else {
        currentContent.mapIndexed { index, part ->
            if (index == existingIndex) {
                val existing = part as AiChatContentPart.ReasoningSummary
                AiChatContentPart.ReasoningSummary(
                    reasoningSummary = existing.reasoningSummary.copy(
                        summary = if (reasoningSummary.summary.isEmpty()) {
                            existing.reasoningSummary.summary
                        } else {
                            reasoningSummary.summary
                        },
                        status = reasoningSummary.status
                    )
                )
            } else {
                part
            }
        }
    }
}

private fun completingReasoningSummary(
    content: List<AiChatContentPart>,
    reasoningId: String
): List<AiChatContentPart> {
    return removingOptimisticAssistantStatus(content = content).mapNotNull { part ->
        when (part) {
            is AiChatContentPart.ReasoningSummary -> {
                if (part.reasoningSummary.reasoningId != reasoningId) {
                    part
                } else if (part.reasoningSummary.summary.isEmpty()) {
                    null
                } else {
                    AiChatContentPart.ReasoningSummary(
                        reasoningSummary = part.reasoningSummary.copy(status = AiChatToolCallStatus.COMPLETED)
                    )
                }
            }

            else -> part
        }
    }
}

private fun finalizingAssistantContent(
    content: List<AiChatContentPart>
): List<AiChatContentPart> {
    return removingOptimisticAssistantStatus(content = content).mapNotNull { part ->
        when (part) {
            is AiChatContentPart.ReasoningSummary -> {
                if (part.reasoningSummary.summary.isEmpty()) {
                    null
                } else {
                    AiChatContentPart.ReasoningSummary(
                        reasoningSummary = part.reasoningSummary.copy(status = AiChatToolCallStatus.COMPLETED)
                    )
                }
            }

            else -> part
        }
    }
}

private fun removingOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): List<AiChatContentPart> {
    if (isOptimisticAssistantStatus(content = content)) {
        return emptyList()
    }

    return content.filterNot { part ->
        part is AiChatContentPart.Text && part.text == aiChatOptimisticAssistantStatusToken
    }
}

private fun isOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): Boolean {
    return content.size == 1
        && content[0] is AiChatContentPart.Text
        && (content[0] as AiChatContentPart.Text).text == aiChatOptimisticAssistantStatusToken
}

private data class StreamingAssistantMessageResolution(
    val state: AiChatPersistedState,
    val index: Int
)

private fun resolveStreamingAssistantMessage(
    state: AiChatPersistedState,
    itemId: String,
    cursor: String
): StreamingAssistantMessageResolution {
    val existingResolution = resolveExistingStreamingAssistantMessage(
        state = state,
        itemId = itemId,
        cursor = cursor
    )
    if (existingResolution != null) {
        return existingResolution
    }

    val message = AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.ASSISTANT,
        content = emptyList(),
        timestampMillis = System.currentTimeMillis(),
        isError = false,
        isStopped = false,
        cursor = cursor,
        itemId = itemId
    )
    val nextMessages = state.messages + message
    return StreamingAssistantMessageResolution(
        state = state.copy(messages = nextMessages),
        index = nextMessages.lastIndex
    )
}

private fun resolveExistingStreamingAssistantMessage(
    state: AiChatPersistedState,
    itemId: String,
    cursor: String
): StreamingAssistantMessageResolution? {
    val existingIndex = state.messages.indexOfFirst { message ->
        message.role == AiChatRole.ASSISTANT && message.itemId == itemId
    }
    if (existingIndex >= 0) {
        val message = state.messages[existingIndex]
        return StreamingAssistantMessageResolution(
            state = state.copy(
                messages = state.messages.replaceAt(
                    index = existingIndex,
                    value = message.copy(cursor = cursor, itemId = itemId)
                )
            ),
            index = existingIndex
        )
    }

    val placeholderIndex = state.messages.indexOfLast { message ->
        message.role == AiChatRole.ASSISTANT && message.itemId == null && message.isStopped == false
    }
    if (placeholderIndex >= 0) {
        val placeholderMessage = state.messages[placeholderIndex]
        return StreamingAssistantMessageResolution(
            state = state.copy(
                messages = state.messages.replaceAt(
                    index = placeholderIndex,
                    value = placeholderMessage.copy(cursor = cursor, itemId = itemId)
                )
            ),
            index = placeholderIndex
        )
    }

    return null
}

private fun <T> List<T>.replaceAt(index: Int, value: T): List<T> {
    return mapIndexed { currentIndex, currentValue ->
        if (currentIndex == index) {
            value
        } else {
            currentValue
        }
    }
}

private fun shouldReconcileAssistantTerminalContent(
    content: List<AiChatContentPart>,
    isError: Boolean,
    isStopped: Boolean
): Boolean {
    if (isError || isStopped) {
        return false
    }

    return content.none { part ->
        when (part) {
            is AiChatContentPart.Text -> part.text.isNotBlank()
            is AiChatContentPart.ReasoningSummary -> part.reasoningSummary.summary.isNotBlank()
            is AiChatContentPart.Image,
            is AiChatContentPart.Card,
            is AiChatContentPart.File,
            is AiChatContentPart.ToolCall,
            is AiChatContentPart.AccountUpgradePrompt,
            is AiChatContentPart.Unknown -> true
        }
    }
}
