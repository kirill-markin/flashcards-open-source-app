package com.flashcardsopensourceapp.data.local.model

import java.util.UUID

const val aiChatDefaultModelId: String = "gpt-5.4"
const val aiChatDefaultModelLabel: String = "GPT-5.4"
const val aiChatDefaultProviderLabel: String = "OpenAI"
const val aiChatDefaultReasoningEffort: String = "medium"
const val aiChatDefaultReasoningLabel: String = "Medium"
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

data class AiChatProvider(
    val id: String,
    val label: String
)

data class AiChatReasoning(
    val effort: String,
    val label: String
)

data class AiChatFeatures(
    val modelPickerEnabled: Boolean,
    val dictationEnabled: Boolean,
    val attachmentsEnabled: Boolean
)

data class AiChatServerModel(
    val id: String,
    val label: String,
    val badgeLabel: String
)

data class AiChatServerConfig(
    val provider: AiChatProvider,
    val model: AiChatServerModel,
    val reasoning: AiChatReasoning,
    val features: AiChatFeatures
)

data class AiChatSessionSnapshot(
    val sessionId: String,
    val runState: String,
    val updatedAtMillis: Long,
    val mainContentInvalidationVersion: Long,
    val messages: List<AiChatMessage>,
    val chatConfig: AiChatServerConfig
)

val defaultAiChatServerConfig: AiChatServerConfig = AiChatServerConfig(
    provider = AiChatProvider(
        id = "openai",
        label = aiChatDefaultProviderLabel
    ),
    model = AiChatServerModel(
        id = aiChatDefaultModelId,
        label = aiChatDefaultModelLabel,
        badgeLabel = "$aiChatDefaultModelLabel · $aiChatDefaultReasoningLabel"
    ),
    reasoning = AiChatReasoning(
        effort = aiChatDefaultReasoningEffort,
        label = aiChatDefaultReasoningLabel
    ),
    features = AiChatFeatures(
        modelPickerEnabled = false,
        dictationEnabled = true,
        attachmentsEnabled = true
    )
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

    data class ReasoningSummary(
        val summary: String
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
    val chatSessionId: String,
    val lastKnownChatConfig: AiChatServerConfig?
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

data class AiChatStartRunRequest(
    val sessionId: String?,
    val content: List<AiChatWireContentPart>,
    val timezone: String,
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
    val chatSessionId: String,
    val chatConfig: AiChatServerConfig?,
    val finalSnapshot: AiChatSessionSnapshot?
)

data class AiChatTranscriptionResult(
    val text: String,
    val sessionId: String
)

data class StoredGuestAiSession(
    val guestToken: String,
    val userId: String,
    val workspaceId: String,
    val configurationMode: CloudServiceConfigurationMode,
    val apiBaseUrl: String
)

fun makeDefaultAiChatPersistedState(): AiChatPersistedState {
    return AiChatPersistedState(
        messages = emptyList(),
        chatSessionId = "",
        lastKnownChatConfig = null
    )
}

fun buildAiChatRequestContent(content: List<AiChatContentPart>): List<AiChatWireContentPart> {
    return content.mapNotNull { part ->
        when (part) {
            is AiChatContentPart.Text -> AiChatWireContentPart.Text(text = part.text)
            is AiChatContentPart.ReasoningSummary -> null
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

fun effectiveAiChatServerConfig(
    persistedConfig: AiChatServerConfig?
): AiChatServerConfig {
    return persistedConfig ?: defaultAiChatServerConfig
}
