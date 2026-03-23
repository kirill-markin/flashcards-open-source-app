package com.flashcardsopensourceapp.data.local.model

import java.util.UUID

const val aiChatDefaultModelId: String = "gpt-5.4"
const val aiChatConsentRequiredMessage: String =
    "Review AI data use and accept it on this device before using AI features."
const val aiChatOptimisticAssistantStatusText: String = "Looking through your cards..."
const val aiChatGuestQuotaReachedMessage: String =
    "Your free guest AI limit for this month is used up. Create an account or log in to keep using AI."
const val aiChatGuestQuotaButtonTitle: String = "Create account or Log in"
const val aiChatMaximumAttachmentBytes: Int = 20 * 1024 * 1024

val aiChatSupportedFileExtensions: Set<String> = setOf(
    "pdf",
    "txt",
    "csv",
    "json",
    "xml",
    "xlsx",
    "xls",
    "md",
    "html",
    "py",
    "js",
    "ts",
    "yaml",
    "yml",
    "sql",
    "log",
    "docx"
)

data class AiChatModelOption(
    val id: String,
    val label: String
)

val aiChatModelOptions: List<AiChatModelOption> = listOf(
    AiChatModelOption(id = "gpt-5.4", label = "GPT-5.4"),
    AiChatModelOption(id = "gpt-5.2", label = "GPT-5.2"),
    AiChatModelOption(id = "gpt-4.1", label = "GPT-4.1"),
    AiChatModelOption(id = "gpt-4.1-mini", label = "GPT-4.1 Mini"),
    AiChatModelOption(id = "gpt-4.1-nano", label = "GPT-4.1 Nano"),
    AiChatModelOption(id = "claude-opus-4-6", label = "Claude Opus 4.6"),
    AiChatModelOption(id = "claude-sonnet-4-6", label = "Claude Sonnet 4.6"),
    AiChatModelOption(id = "claude-haiku-4-5", label = "Claude Haiku 4.5")
)

enum class AiChatRole {
    USER,
    ASSISTANT
}

enum class AiChatToolCallStatus {
    STARTED,
    COMPLETED
}

enum class AiChatDictationState {
    IDLE,
    REQUESTING_PERMISSION,
    RECORDING,
    TRANSCRIBING
}

data class AiChatAttachment(
    val id: String,
    val fileName: String,
    val mediaType: String,
    val base64Data: String
) {
    val isImage: Boolean
        get() = mediaType.startsWith(prefix = "image/")
}

data class AiChatToolCall(
    val toolCallId: String,
    val name: String,
    val status: AiChatToolCallStatus,
    val input: String?,
    val output: String?
)

sealed interface AiChatContentPart {
    data class Text(
        val text: String
    ) : AiChatContentPart

    data class Image(
        val fileName: String?,
        val mediaType: String,
        val base64Data: String
    ) : AiChatContentPart

    data class File(
        val fileName: String,
        val mediaType: String,
        val base64Data: String
    ) : AiChatContentPart

    data class ToolCall(
        val toolCall: AiChatToolCall
    ) : AiChatContentPart

    data class AccountUpgradePrompt(
        val message: String,
        val buttonTitle: String
    ) : AiChatContentPart
}

data class AiChatMessage(
    val messageId: String,
    val role: AiChatRole,
    val content: List<AiChatContentPart>,
    val timestampMillis: Long,
    val isError: Boolean
)

data class AiChatPersistedState(
    val messages: List<AiChatMessage>,
    val selectedModelId: String,
    val chatSessionId: String,
    val codeInterpreterContainerId: String?
)

data class AiChatUserContext(
    val totalCards: Int
)

sealed interface AiChatWireContentPart {
    data class Text(
        val text: String
    ) : AiChatWireContentPart

    data class Image(
        val mediaType: String,
        val base64Data: String
    ) : AiChatWireContentPart

    data class File(
        val fileName: String,
        val mediaType: String,
        val base64Data: String
    ) : AiChatWireContentPart

    data class ToolCall(
        val toolCallId: String,
        val name: String,
        val status: AiChatToolCallStatus,
        val input: String?,
        val output: String?
    ) : AiChatWireContentPart
}

data class AiChatWireMessage(
    val role: String,
    val content: List<AiChatWireContentPart>
)

data class AiChatTurnRequest(
    val messages: List<AiChatWireMessage>,
    val model: String,
    val timezone: String,
    val devicePlatform: String,
    val chatSessionId: String,
    val codeInterpreterContainerId: String?,
    val userContext: AiChatUserContext
)

data class AiToolCallRequest(
    val toolCallId: String,
    val name: String,
    val input: String
)

data class AiChatRepairAttemptStatus(
    val message: String,
    val attempt: Int,
    val maxAttempts: Int,
    val toolName: String?
)

data class AiChatStreamError(
    val message: String,
    val code: String,
    val stage: String,
    val requestId: String
)

sealed interface AiChatStreamEvent {
    data class Delta(
        val text: String
    ) : AiChatStreamEvent

    data class ToolCall(
        val toolCall: AiChatToolCall
    ) : AiChatStreamEvent

    data class ToolCallRequest(
        val toolCallRequest: AiToolCallRequest
    ) : AiChatStreamEvent

    data class RepairAttempt(
        val status: AiChatRepairAttemptStatus
    ) : AiChatStreamEvent

    data object Done : AiChatStreamEvent

    data class Error(
        val error: AiChatStreamError
    ) : AiChatStreamEvent
}

data class AiChatStreamOutcome(
    val requestId: String?,
    val codeInterpreterContainerId: String?
)

data class StoredGuestAiSession(
    val guestToken: String,
    val userId: String,
    val workspaceId: String,
    val configurationMode: CloudServiceConfigurationMode,
    val apiBaseUrl: String
)

fun makeAiChatSessionId(): String {
    return UUID.randomUUID().toString().lowercase()
}

fun makeDefaultAiChatPersistedState(): AiChatPersistedState {
    return AiChatPersistedState(
        messages = emptyList(),
        selectedModelId = aiChatDefaultModelId,
        chatSessionId = makeAiChatSessionId(),
        codeInterpreterContainerId = null
    )
}

fun buildAiChatWireMessages(messages: List<AiChatMessage>): List<AiChatWireMessage> {
    return messages.map { message ->
        AiChatWireMessage(
            role = when (message.role) {
                AiChatRole.USER -> "user"
                AiChatRole.ASSISTANT -> "assistant"
            },
            content = message.content.mapNotNull { part ->
                when (part) {
                    is AiChatContentPart.Text -> AiChatWireContentPart.Text(text = part.text)
                    is AiChatContentPart.Image -> AiChatWireContentPart.Image(
                        mediaType = part.mediaType,
                        base64Data = part.base64Data
                    )

                    is AiChatContentPart.File -> AiChatWireContentPart.File(
                        fileName = part.fileName,
                        mediaType = part.mediaType,
                        base64Data = part.base64Data
                    )

                    is AiChatContentPart.ToolCall -> AiChatWireContentPart.ToolCall(
                        toolCallId = part.toolCall.toolCallId,
                        name = part.toolCall.name,
                        status = part.toolCall.status,
                        input = part.toolCall.input,
                        output = part.toolCall.output
                    )

                    is AiChatContentPart.AccountUpgradePrompt -> null
                }
            }
        )
    }
}

fun makeAiChatAttachment(
    fileName: String,
    mediaType: String,
    base64Data: String
): AiChatAttachment {
    return AiChatAttachment(
        id = UUID.randomUUID().toString().lowercase(),
        fileName = fileName,
        mediaType = mediaType,
        base64Data = base64Data
    )
}

fun requireAiChatAttachmentSize(byteCount: Int) {
    require(byteCount <= aiChatMaximumAttachmentBytes) {
        "File is too large. Maximum allowed size is 20 MB."
    }
}

fun requireSupportedAiChatAttachmentExtension(fileExtension: String) {
    val normalizedExtension = fileExtension.trim().lowercase()
    require(aiChatSupportedFileExtensions.contains(normalizedExtension)) {
        "Unsupported file type: .$normalizedExtension"
    }
}

fun enforceAllowedAiChatModel(
    selectedModelId: String,
    isLinked: Boolean
): String {
    if (isLinked) {
        return selectedModelId
    }

    return aiChatDefaultModelId
}

fun availableAiChatModels(isLinked: Boolean): List<AiChatModelOption> {
    if (isLinked) {
        return aiChatModelOptions
    }

    return listOf(
        AiChatModelOption(
            id = aiChatDefaultModelId,
            label = "GPT-5.4"
        )
    )
}
