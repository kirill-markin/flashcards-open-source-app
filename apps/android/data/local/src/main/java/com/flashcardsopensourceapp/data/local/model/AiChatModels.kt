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
    val features: AiChatFeatures,
    val liveUrl: String?
)

data class AiChatLiveStreamEnvelope(
    val url: String,
    val authorization: String,
    val expiresAt: Long
)

data class AiChatConversation(
    val messages: List<AiChatMessage>,
    val updatedAtMillis: Long,
    val mainContentInvalidationVersion: Long,
    val hasOlder: Boolean,
    val oldestCursor: String?
)

data class AiChatActiveRunLive(
    val cursor: String?,
    val stream: AiChatLiveStreamEnvelope
)

data class AiChatActiveRun(
    val runId: String,
    val status: String,
    val live: AiChatActiveRunLive,
    val lastHeartbeatAtMillis: Long?
)

data class AiChatConversationEnvelope(
    val sessionId: String,
    val conversationScopeId: String,
    val conversation: AiChatConversation,
    val composerSuggestions: List<AiChatComposerSuggestion>,
    val chatConfig: AiChatServerConfig,
    val activeRun: AiChatActiveRun?
)

typealias AiChatSessionSnapshot = AiChatConversationEnvelope

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
    ),
    liveUrl = null
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

data class AiChatComposerSuggestion(
    val id: String,
    val text: String,
    val source: String,
    val assistantItemId: String?
)

data class AiChatToolCall(
    val toolCallId: String,
    val name: String,
    val status: AiChatToolCallStatus,
    val input: String?,
    val output: String?
)

data class AiChatReasoningSummary(
    val reasoningId: String,
    val summary: String,
    val status: AiChatToolCallStatus
)

sealed interface AiChatContentPart {
    data class Text(
        val text: String
    ) : AiChatContentPart

    data class ReasoningSummary(
        val reasoningSummary: AiChatReasoningSummary
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
    val isError: Boolean,
    val isStopped: Boolean,
    val cursor: String?,
    val itemId: String?
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
    val clientRequestId: String,
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

data class AiChatAcceptedConversationEnvelope(
    val accepted: Boolean,
    val sessionId: String,
    val conversationScopeId: String,
    val conversation: AiChatConversation,
    val composerSuggestions: List<AiChatComposerSuggestion>,
    val chatConfig: AiChatServerConfig,
    val activeRun: AiChatActiveRun?,
    val deduplicated: Boolean?
)

typealias AiChatStartRunResponse = AiChatAcceptedConversationEnvelope

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

data class AiChatAttachmentReference(
    val id: String,
    val kind: String,
    val displayName: String,
    val mediaType: String
)

typealias AiChatBootstrapResponse = AiChatConversationEnvelope

data class AiChatStopRunResponse(
    val sessionId: String,
    val conversationScopeId: String,
    val runId: String?,
    val stopped: Boolean,
    val stillRunning: Boolean
)

data class AiChatOlderMessagesResponse(
    val messages: List<AiChatMessage>,
    val hasOlder: Boolean,
    val oldestCursor: String?
)

enum class AiChatRunTerminalOutcome {
    COMPLETED,
    STOPPED,
    ERROR,
    RESET_REQUIRED
}

data class AiChatLiveEventMetadata(
    val sessionId: String,
    val conversationScopeId: String,
    val runId: String,
    val cursor: String?,
    val sequenceNumber: Int,
    val streamEpoch: String
)

sealed interface AiChatLiveEvent {
    data class AssistantDelta(
        val metadata: AiChatLiveEventMetadata,
        val text: String,
        val itemId: String
    ) : AiChatLiveEvent

    data class AssistantToolCall(
        val metadata: AiChatLiveEventMetadata,
        val toolCall: AiChatToolCall,
        val itemId: String,
        val outputIndex: Int,
        val providerStatus: String?
    ) : AiChatLiveEvent

    data class AssistantReasoningStarted(
        val metadata: AiChatLiveEventMetadata,
        val reasoningId: String,
        val itemId: String,
        val outputIndex: Int
    ) : AiChatLiveEvent

    data class AssistantReasoningSummary(
        val metadata: AiChatLiveEventMetadata,
        val reasoningSummary: AiChatReasoningSummary,
        val itemId: String,
        val outputIndex: Int
    ) : AiChatLiveEvent

    data class AssistantReasoningDone(
        val metadata: AiChatLiveEventMetadata,
        val reasoningId: String,
        val itemId: String,
        val outputIndex: Int
    ) : AiChatLiveEvent

    data class AssistantMessageDone(
        val metadata: AiChatLiveEventMetadata,
        val itemId: String,
        val content: List<AiChatContentPart>,
        val isError: Boolean,
        val isStopped: Boolean
    ) : AiChatLiveEvent

    data class ComposerSuggestionsUpdated(
        val metadata: AiChatLiveEventMetadata,
        val suggestions: List<AiChatComposerSuggestion>
    ) : AiChatLiveEvent

    data class RepairStatus(
        val metadata: AiChatLiveEventMetadata,
        val status: AiChatRepairAttemptStatus
    ) : AiChatLiveEvent

    data class RunTerminal(
        val metadata: AiChatLiveEventMetadata,
        val outcome: AiChatRunTerminalOutcome,
        val message: String?,
        val assistantItemId: String?,
        val isError: Boolean?,
        val isStopped: Boolean?
    ) : AiChatLiveEvent
}

data class AiChatMinimalPersistedState(
    val lastSessionId: String,
    val draftText: String
)

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
