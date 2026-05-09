package com.flashcardsopensourceapp.data.local.model

import java.util.UUID

const val aiChatDefaultModelId: String = "gpt-5.4"
const val aiChatDefaultModelLabel: String = "GPT-5.4"
const val aiChatDefaultProviderLabel: String = "OpenAI"
const val aiChatDefaultReasoningEffort: String = "medium"
const val aiChatDefaultReasoningLabel: String = "Medium"
const val aiChatOptimisticAssistantStatusToken: String = "__ai_optimistic_assistant_status__"
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

sealed interface AiChatAttachment {
    val id: String

    data class Binary(
        override val id: String,
        val fileName: String,
        val mediaType: String,
        val base64Data: String
    ) : AiChatAttachment {
        val isImage: Boolean
            get() = mediaType.startsWith(prefix = "image/")
    }

    data class Card(
        override val id: String,
        val cardId: String,
        val frontText: String,
        val backText: String,
        val tags: List<String>,
        val effortLevel: EffortLevel
    ) : AiChatAttachment

    data class Unknown(
        override val id: String,
        val originalType: String,
        val summaryText: String,
        val rawPayloadJson: String?
    ) : AiChatAttachment
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

    data class Card(
        val cardId: String,
        val frontText: String,
        val backText: String,
        val tags: List<String>,
        val effortLevel: EffortLevel
    ) : AiChatContentPart

    data class ToolCall(
        val toolCall: AiChatToolCall
    ) : AiChatContentPart

    data class AccountUpgradePrompt(
        val message: String,
        val buttonTitle: String
    ) : AiChatContentPart

    data class Unknown(
        val originalType: String,
        val summaryText: String,
        val rawPayloadJson: String?
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
    val lastKnownChatConfig: AiChatServerConfig?,
    val pendingToolRunPostSync: Boolean,
    val requiresRemoteSessionProvisioning: Boolean
)

data class AiChatSessionProvisioningResult(
    val sessionId: String,
    val snapshot: AiChatSessionSnapshot?
)

data class AiChatDraftState(
    val draftMessage: String,
    val pendingAttachments: List<AiChatAttachment>
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

    data class Card(
        val cardId: String,
        val frontText: String,
        val backText: String,
        val tags: List<String>,
        val effortLevel: EffortLevel
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
    val sessionId: String,
    val workspaceId: String?,
    val clientRequestId: String,
    val content: List<AiChatWireContentPart>,
    val timezone: String,
    val uiLocale: String?,
)

data class AiChatNewSessionRequest(
    val sessionId: String,
    val workspaceId: String?,
    val uiLocale: String?,
)

data class AiChatStopRunRequest(
    val sessionId: String,
    val workspaceId: String?,
    // TODO: Remove optional runId and make it required after most users have updated to the latest version. This is a legacy path.
    val runId: String?,
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
        lastKnownChatConfig = null,
        pendingToolRunPostSync = false,
        requiresRemoteSessionProvisioning = false
    )
}

fun makeDefaultAiChatDraftState(): AiChatDraftState {
    return AiChatDraftState(
        draftMessage = "",
        pendingAttachments = emptyList()
    )
}

fun AiChatDraftState.isEmpty(): Boolean {
    return draftMessage.isBlank() && pendingAttachments.isEmpty()
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

            is AiChatContentPart.Card -> AiChatWireContentPart.Card(
                cardId = part.cardId,
                frontText = part.frontText,
                backText = part.backText,
                tags = part.tags,
                effortLevel = part.effortLevel
            )

            is AiChatContentPart.ToolCall -> AiChatWireContentPart.ToolCall(
                toolCallId = part.toolCall.toolCallId,
                name = part.toolCall.name,
                status = part.toolCall.status,
                input = part.toolCall.input,
                output = part.toolCall.output
            )

            is AiChatContentPart.AccountUpgradePrompt -> null
            is AiChatContentPart.Unknown -> null
        }
    }
}

fun isSendableAiChatAttachment(attachment: AiChatAttachment): Boolean {
    return when (attachment) {
        is AiChatAttachment.Binary,
        is AiChatAttachment.Card -> true
        is AiChatAttachment.Unknown -> false
    }
}

fun makeAiChatAttachment(
    fileName: String,
    mediaType: String,
    base64Data: String
): AiChatAttachment {
    return AiChatAttachment.Binary(
        id = UUID.randomUUID().toString().lowercase(),
        fileName = fileName,
        mediaType = mediaType,
        base64Data = base64Data
    )
}

fun makeAiChatCardAttachment(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>,
    effortLevel: EffortLevel
): AiChatAttachment.Card {
    return AiChatAttachment.Card(
        id = UUID.randomUUID().toString().lowercase(),
        cardId = cardId,
        frontText = frontText,
        backText = backText,
        tags = tags,
        effortLevel = effortLevel
    )
}

fun aiChatEffortLevelWireValue(effortLevel: EffortLevel): String {
    return effortLevel.name.lowercase()
}

fun formatAiChatCardAttachmentLabel(frontText: String): String {
    val trimmedFrontText = frontText.trim()
    if (trimmedFrontText.isEmpty()) {
        return "Card"
    }

    return "Card · " + trimmedFrontText.take(n = 72)
}

fun buildAiChatCardContextXml(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>,
    effortLevel: EffortLevel
): String {
    val escapedTags = tags.joinToString(separator = "") { tag ->
        "<tag>${escapeAiChatCardXmlValue(value = tag)}</tag>"
    }

    // Keep this byte-for-byte aligned with apps/backend/src/chat/cardContext.ts::buildCardContextXml.
    return buildString {
        append("<attached_card>\n")
        append("<card_id>")
        append(escapeAiChatCardXmlValue(value = cardId))
        append("</card_id>\n")
        append("<effort_level>")
        append(escapeAiChatCardXmlValue(value = aiChatEffortLevelWireValue(effortLevel = effortLevel)))
        append("</effort_level>\n")
        append("<front_text>\n")
        append(escapeAiChatCardXmlValue(value = frontText))
        append("\n</front_text>\n")
        append("<back_text>\n")
        append(escapeAiChatCardXmlValue(value = backText))
        append("\n</back_text>\n")
        append("<tags>")
        append(escapedTags)
        append("</tags>\n")
        append("</attached_card>")
    }
}

private fun escapeAiChatCardXmlValue(value: String): String {
    return value
        .replace(oldValue = "&", newValue = "&amp;")
        .replace(oldValue = "<", newValue = "&lt;")
        .replace(oldValue = ">", newValue = "&gt;")
        .replace(oldValue = "\"", newValue = "&quot;")
        .replace(oldValue = "'", newValue = "&apos;")
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
