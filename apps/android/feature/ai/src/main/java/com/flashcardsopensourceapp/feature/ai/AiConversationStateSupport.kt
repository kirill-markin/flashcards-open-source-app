package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText
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
        isError = false
    )
}

internal fun makeAssistantStatusMessage(timestampMillis: Long): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.ASSISTANT,
        content = listOf(
            AiChatContentPart.Text(text = aiChatOptimisticAssistantStatusText)
        ),
        timestampMillis = timestampMillis,
        isError = false
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
    return if (attachment.isImage) {
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

internal fun appendAssistantText(
    state: AiChatPersistedState,
    text: String
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val updatedContent = if (isOptimisticAssistantStatus(content = lastMessage.content)) {
        listOf(AiChatContentPart.Text(text = text))
    } else if (lastMessage.content.lastOrNull() is AiChatContentPart.Text) {
        lastMessage.content.dropLast(1) + AiChatContentPart.Text(
            text = (lastMessage.content.last() as AiChatContentPart.Text).text + text
        )
    } else {
        lastMessage.content + AiChatContentPart.Text(text = text)
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

internal fun upsertAssistantToolCall(
    state: AiChatPersistedState,
    toolCall: AiChatToolCall
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val currentContent = removingOptimisticAssistantStatus(content = lastMessage.content)
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

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

internal fun upsertAssistantToolCallRequest(
    state: AiChatPersistedState,
    toolCallRequest: AiToolCallRequest
): AiChatPersistedState {
    return upsertAssistantToolCall(
        state = state,
        toolCall = AiChatToolCall(
            toolCallId = toolCallRequest.toolCallId,
            name = toolCallRequest.name,
            status = AiChatToolCallStatus.STARTED,
            input = toolCallRequest.input,
            output = null
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
                    isError = true
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
                isError = true
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
                content = lastMessage.content,
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
                    isError = false
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
                isError = false
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

private fun removingOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): List<AiChatContentPart> {
    if (isOptimisticAssistantStatus(content = content)) {
        return emptyList()
    }

    return content.filterNot { part ->
        part is AiChatContentPart.Text && part.text == aiChatOptimisticAssistantStatusText
    }
}

private fun isOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): Boolean {
    return content.size == 1
        && content[0] is AiChatContentPart.Text
        && (content[0] as AiChatContentPart.Text).text == aiChatOptimisticAssistantStatusText
}
